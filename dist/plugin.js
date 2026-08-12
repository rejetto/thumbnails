exports.version = 4.84
exports.description = "Show thumbnails for images in place of icons. It uses EXIF if available."
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
    regenerateBefore: { type: 'date_time', helperText: "Older are regenerated", xs: 6 },
    log: { type: 'boolean', defaultValue: false, label: "Include thumbnails in log" },
    showTilesInMenu: { frontend: true, type: 'boolean', defaultValue: true, label: "Show tiles in file menu" },
    lazyLoading: { frontend: true,type: 'boolean', defaultValue: true, xs: 7, helperText: "Less traffic but slower displaying" },
    exif: { type: 'boolean', defaultValue: true, label: "EXIF", xs: 5 },
    videos: {
        frontend: true,
        type: 'boolean',
        defaultValue: false,
        label: "Enable experimental videos support",
    },
}
exports.changelog = [
    { "version": 4.84, "message": "Fixed cached JPEG type and embedded EXIF thumbnails" },
    { "version": 4.83, "message": "Fewer black frames for videos" },
    { "version": 4.81, "message": "Fix: wrong timestamp on files" },
    { "version": 4.8, "message": "Added `regenerate before` and `exif` configuration" },
    { "version": 4.7, "message": "Added `pixels` configuration" },
    { "version": 4.6, "message": "Added `quality` configuration" }
]

exports.configDialog = {
    maxWidth: 'xs',
}

const JPEG_START = Buffer.from([0xFF, 0xD8, 0xFF])
const JPEG_END = Buffer.from([0xFF, 0xD9])

exports.init = async api => {
    const { createReadStream, rm } = api.require('fs')
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
                const pixels = api.getConfig('pixels')
                const w = dimension(ctx.query.w, pixels)
                const h = dimension(ctx.query.h, w)
                const customSize = 'w' in ctx.query || 'h' in ctx.query
                const K = 'thumbnail'
                const {size, mtimeMs: ts} = ctx.state.fileStats
                // try cache
                const cached = await loadFileAttr(fileSource, K).catch(failSilently)
                const regenerateBefore = api.getConfig('regenerateBefore')
                if (cached?.ts === ts && (!regenerateBefore || cached.thumbTs >= regenerateBefore)
                    && (!customSize || cached.w === w && cached.h === h)) {
                    ctx.set(header, 'cache')
                    if (cached.mime)
                        ctx.type = cached.mime
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
                    // try reading exif thumbnail
                    const head = api.getConfig('exif') && await buffer(createReadStream(fileSource, { start: 0, end: 96 * 1024 }))
                    const thumb = head && readThumb(head)
                    if (thumb) {
                        ctx.set(header, 'embedded')
                        ctx.type = 'image/jpeg'
                        return ctx.body = thumb
                    }
                    ctx.set(header, 'full')
                    // consider full file
                    if (size < api.getConfig('fullThreshold') * 1024)
                        return // leave it to existing ctx.body
                    // generate new thumbnail
                    ctx.body.end = 1E8 // 100MB hard limit for file stream
                    const content = await buffer(ctx.body)
                    const quality = api.getConfig('quality')
                    ctx.set(header, 'generated')
                    const res = api.customApiCall('sharp', content)[0]
                    if (!res)
                        return error(500, 'missing "sharp" plugin')
                    try {
                        ctx.body = Buffer.from(await res.resize(w, h, { fit: 'inside' }).rotate().jpeg({ quality }).toBuffer())
                        ctx.type = 'image/jpeg'
                    }
                    catch(e) {
                        console.debug('thumbnails plugin:', e.message || e, fileSource)
                        return error(501, e.message || String(e))
                    }
                }
                if (!customSize) // don't replace the default thumbnail with a one-off requested size
                    storeFileAttr(fileSource, K, { ts, thumbTs: new Date(), mime: ctx.type, w, h, base64: ctx.body.toString('base64') })
                        .catch(failSilently)
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

    function dimension(value, fallback) {
        const n = Number(value)
        return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 2000) : fallback
    }

    function readThumb(buffer) {
        const start = buffer.indexOf(JPEG_START, 2)
        if (start < 0) return
        const end = buffer.indexOf(JPEG_END, start)
        if (end < 0) return
        return buffer.slice(start, end + 2)
    }

}
