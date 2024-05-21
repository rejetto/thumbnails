exports.version = 4
exports.description = "Show thumbnails for images in place of icons"
exports.apiRequired = 8.65 // ctx.state.fileSource
exports.frontend_js = 'main.js'
exports.repo = "rejetto/thumbnails"
exports.depend = [{ "repo": "rejetto/sharp", "version": 1 }]
exports.config = {
    fullThreshold: {
        type: 'number',
        unit: 'KB',
        defaultValue: 100,
        min: 0,
        label: "Serve full file if size is less than",
        sm: 6,
    },
    log: {
        type: 'boolean',
        defaultValue: false,
        label: "Include thumbnails in log",
    },
    showTilesInMenu: {
        frontend: true,
        type: 'boolean',
        defaultValue: true,
    },
    videos: {
        frontend: true,
        type: 'boolean',
        defaultValue: false,
        label: "Enable experimental videos support",
    },
}

exports.configDialog = {
    maxWidth: 'xs',
}

const THUMB_SIZE = 256

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
                // call for other plugins
                const others = api.customApiCall('thumbnails_get', { ctx, path: ctx.state.fileSource })
                const custom = await others[0]
                if (custom !== undefined) {
                    ctx.set(header, 'custom')
                    return ctx.body = custom
                }
                // try embedded
                const {fileSource} = ctx.state
                const head = await buffer(createReadStream(fileSource, { start: 0 , end: 96 * 1024 }))
                const thumb = readThumb(head)
                if (thumb) {
                    ctx.set(header, 'embedded')
                    return ctx.body = thumb
                }
                ctx.set(header, 'NOPE')
                // consider full file
                const {size, mtimeMs: ts} = ctx.state.fileStats
                if (size < api.getConfig('fullThreshold') * 1024)
                    return // leave it to existing ctx.body
                // try cache
                const K = 'thumbnail'
                const cached = await loadFileAttr(fileSource, K).catch(failSilently)
                if (cached?.ts === ts) {
                    ctx.set(header, 'cache')
                    return ctx.body = Buffer.from(cached.base64, 'base64')
                }
                // generate new thumbnail
                const content = await buffer(ctx.body)
                const w = Number(ctx.query.w) || THUMB_SIZE
                const h = Number(ctx.query.h)
                const quality = 20
                ctx.set(header, 'generated')
                const res = api.customApiCall('sharp', content)[0]
                if (!res)
                    return error(500, 'missing "sharp" plugin')
                try {
                    ctx.body = Buffer.from(await res.resize(w, h||w, { fit: 'inside' }).rotate().jpeg({ quality }).toBuffer())
                }
                catch(e) {
                    console.debug('thumbnails plugin:', e.message || e)
                    return error(501, e.message || String(e))
                }
                storeFileAttr(fileSource, K, { ts, base64: ctx.body.toString('base64') }).catch(failSilently) // don't wait
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
