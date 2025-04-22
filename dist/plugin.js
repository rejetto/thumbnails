exports.version = 4.7
exports.description = "Show thumbnails for images in place of icons"
exports.apiRequired = 8.65 // ctx.state.fileSource
exports.frontend_js = 'main.js'
exports.repo = "rejetto/thumbnails"
exports.depend = [{ "repo": "rejetto/sharp", "version": 1 }]
exports.preview = ["https://github.com/rejetto/thumbnails/assets/1367199/d74a8a24-a6f8-4460-93de-74d9d6bd413f"]
exports.config = {
    quality: {
        type: 'number',
        defaultValue: 20,
        min: 1, max: 100,
        helperText: "100 is best quality but bigger size",
        xs: 6,
    },
    pixels: {
        type: 'number',
        defaultValue: 256,
        min: 10, max: 2000,
        helperText: "Dimensions of longest side",
        unit: 'pixels',
        xs: 6,
    },
    fullThreshold: {
        type: 'number',
        unit: 'KB',
        defaultValue: 100,
        min: 0,
        label: "Serve original file under",
        helperText: "Don't generate a thumbnail",
        xs: 6,
    },
    log: {
        type: 'boolean',
        defaultValue: false,
        label: "Include thumbnails in log",
    },
    showTilesInMenu: { frontend: true, type: 'boolean', defaultValue: true },
    lazyLoading: { frontend: true, type: 'boolean', defaultValue: true, helperText: "Less traffic but slower displaying" },
    videos: {
        frontend: true,
        type: 'boolean',
        defaultValue: false,
        label: "Enable experimental videos support",
    },
}
exports.changelog = [
    { "version": 4.7, "message": "Added \"pixels\" configuration" },
    { "version": 4.6, "message": "Added \"quality\" configuration" }
]

exports.configDialog = {
    maxWidth: 'xs',
}

exports.init = async api => {
    const { createReadStream, rm } = api.require('fs')
    const { utimes } = api.require('fs/promises')
    const { buffer } = api.require('node:stream/consumers')
    const { loadFileAttr, storeFileAttr } = api.require('./misc')

    rm(api.storageDir + 'cache',  { recursive: true, force: true }, () => {}) // remove legacy db
    const header = 'x-thumbnail'
    return {
        middleware(ctx) {
            if (ctx.query.get !== 'thumb') return
            ctx.state.considerAsGui = true
            ctx.state.download_counter_ignore = true
            return async () => {
                if (!ctx.body) return // !body includes 304 responses
                if (!api.getConfig('log'))
                    ctx.state.dontLog = true
                const {fileSource} = ctx.state
                if (!fileSource) return // file not accessible, for some reason, like permissions
                const K = 'thumbnail'
                const {size, mtimeMs: ts} = ctx.state.fileStats
                // try cache
                const cached = await loadFileAttr(fileSource, K).catch(failSilently)
                if (cached?.ts === ts) {
                    ctx.set(header, 'cache')
                    if (cached.type)
                        ctx.type = cached.type
                    return ctx.body = Buffer.from(cached.base64, 'base64')
                }
                // call for other plugins
                const res = await Promise.all(api.customApiCall('thumbnails_get', { ctx, path: ctx.state.fileSource })).then(x => x.find(Boolean))
                if (res) {
                    ctx.set(header, 'plugin')
                    ctx.body = res.data || res
                    if (res.type)
                        ctx.type = res.type
                    //api.log(ctx.type)
                    if (res.cache === false) return
                }
                else {
                    // try reading embedded thumbnail
                    const head = await buffer(createReadStream(fileSource, { start: 0, end: 96 * 1024 }))
                    const thumb = readThumb(head)
                    if (thumb) {
                        ctx.set(header, 'embedded')
                        return ctx.body = thumb
                    }
                    ctx.set(header, 'full')
                    // consider full file
                    if (size < api.getConfig('fullThreshold') * 1024)
                        return // leave it to existing ctx.body
                    // generate new thumbnail
                    ctx.body.end = 1E8 // 100MB hard limit for file stream
                    const content = await buffer(ctx.body)
                    const w = Number(ctx.query.w) || api.getConfig('pixels')
                    const h = Number(ctx.query.h)
                    const quality = api.getConfig('quality')
                    ctx.set(header, 'generated')
                    const res = api.customApiCall('sharp', content)[0]
                    if (!res)
                        return error(500, 'missing "sharp" plugin')
                    try {
                        ctx.body = Buffer.from(await res.resize(w, h||w, { fit: 'inside' }).rotate().jpeg({ quality }).toBuffer())
                    }
                    catch(e) {
                        console.debug('thumbnails plugin:', e.message || e, fileSource)
                        return error(501, e.message || String(e))
                    }
                }
                // don't wait
                storeFileAttr(fileSource, K, { ts, mime: ctx.type, base64: ctx.body.toString('base64') })
                    .then(() => utimes(fileSource, new Date(ts), new Date(ts)), failSilently) // restore timestamp
            }

            function error(code, body) {
                ctx.status = code
                ctx.type = 'text'
                ctx.body = body
            }
        }
    }

    function failSilently(e) {
        console.debug(`thumbnails: ${e.message || e}`)
    }

    function readThumb(buffer) {
        const start = buffer.indexOf('\xFF\xD8\xFF', 2)
        if (start < 0) return
        const end = buffer.indexOf('\xFF\xD9', start)
        if (end < 0) return
        return buffer.slice(start, end)
    }

}
