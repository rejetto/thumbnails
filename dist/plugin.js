exports.version = 0.5
exports.description = "Show thumbnails for images in place of icons"
exports.apiRequired = 8.21 // storageDir, customApi
exports.frontend_js = 'main.js'
exports.repo = "rejetto/thumbnails"
exports.config = {
    cache: {
        type: 'select',
        defaultValue: 'storage',
        xs: 6,
        options: {
            "RAM (volatile)": 'ram',
            "disk storage": 'storage',
        }
    },
    fullThreshold: {
        type: 'number',
        xs: 6,
        unit: 'KB',
        defaultValue: 100,
        min: 0,
        label: "Serve full file if size is less than",
    },
}

exports.configDialog = {
    maxWidth: 'xs',
}

const THUMB_SIZE = 256

const sharp = require('sharp')
const { Level } = require('level')

exports.init = async api => {
    const { onOff } = api.require('./misc')
    const ramCache = new Map()
    const dbCache = new Level(api.storageDir + 'cache', { valueEncoding: 'buffer' })
    await dbCache.open()
    const header = 'x-thumbnail'
    return {
        unload() {
            ramCache.clear()
            return dbCache.close()
        },
        middleware(ctx) {
            return async () => {
                if (ctx.query.get !== 'thumb' || !ctx.body) return // !body includes 304 responses
                let buffer = await getFromStream(ctx.body, 96 * 1024)
                // try cache
                const cacheKey = ctx.fileSource
                const cacheRam = api.getConfig('cache') === 'ram'
                const cached = cacheRam ? ramCache.get(cacheKey)
                    : await dbCache.get(cacheKey).catch(failSilently)
                if (cached) {
                    ctx.set(header, 'cache')
                    return ctx.body = Buffer.from(cached)
                }
                // call for other plugins
                const [custom] = api.customApiCall('thumbnails_get', { ctx, path: ctx.fileSource })
                if (custom !== undefined) {
                    ctx.set(header, 'custom')
                    return ctx.body = custom
                }
                // try embedded
                const thumb = readThumb(buffer)
                ctx.set(header, 'NOPE')
                if (thumb) {
                    ctx.set(header, 'embedded')
                    return ctx.body = thumb
                }
                // consider full file
                const {size} = ctx.fileStats
                if (size < api.getConfig('fullThreshold') * 1024)
                    return ctx.redirect(ctx.state.revProxyPath + ctx.originalUrl.replace(/\?.+$/,''))
                // generate new thumbnail
                buffer = await getFromStream(ctx.body, Infinity, { buffer }) // read the rest
                const w = Number(ctx.query.w) || THUMB_SIZE
                const h = Number(ctx.query.h)
                const quality = 60
                ctx.set(header, 'generated')
                const generated = sharp ? Buffer.from(await sharp(buffer).resize(w, h||w, { fit: 'inside' }).rotate().jpeg({ quality }).toBuffer())
                    : await new Promise(async (resolve, reject) => { // fallback
                        const img = await Jimp.read(buffer)
                        img.scaleToFit(w, h).quality(quality).getBuffer('image/jpeg', (e, data) =>
                            e ? reject(e) : resolve(data))
                        ctx.set(header, 'generated-jimp')
                    })
                ctx.body = generated
                if (cacheRam)
                    ramCache.set(cacheKey, generated)
                else
                    dbCache.put(cacheKey, generated).catch(failSilently) // don't wait
            }
        }
    }

    function failSilently(e) {
        console.debug(`thumbnails db failed: ${e.message || e}`)
    }

    function readThumb(buffer) {
        const start = buffer.indexOf('\xFF\xD8\xFF', 2)
        if (start < 0) return
        const end = buffer.indexOf('\xFF\xD9', start)
        if (end < 0) return
        return buffer.slice(start, end)
    }

    function getFromStream(stream, bytes, { buffer }={}) {
        return new Promise((resolve, reject) => {
            buffer ??= Buffer.alloc(0)
            const off = onOff(stream, {
                end,
                error: reject,
                data(chunk) {
                    buffer = Buffer.concat([buffer, chunk])
                    if (buffer.length >= bytes)
                        end()
                }
            })
            stream.resume()

            function end() {
                off()
                stream.pause()
                resolve(buffer)
            }
        })
    }

}
