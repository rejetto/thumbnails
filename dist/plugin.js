exports.version = 1.0
exports.description = "Show thumbnails for images in place of icons"
exports.apiRequired = 8.2 // platform-dependent distribution
exports.frontend_js = 'main.js'
exports.repo = 'rejetto/thumbnails'
exports.config = {
    cache: {
        type: 'select',
        defaultValue: 'ram',
        options: {
            ram: "volatile/RAM",
            embed: "embed in image file",
        }
    },
    fullThreshold: {
        type: 'number',
        unit: 'KB',
        defaultValue: 100,
        min: 0,
        label: "Serve full file if size is less than",
    },
}

const THUMB_SIZE = 256

self = globalThis
require('./jimp.min')
const { Jimp } = self
globalThis.fetch ??= require('./unfetch') // polyfill node16

let sharp
try { sharp = require('sharp') }
catch { console.debug('no sharp') }

const sharpZips = {
    common: 'https://github.com/rejetto/thumbnails/raw/main/zip/common.zip',
    linux: 'https://github.com/rejetto/thumbnails/raw/main/zip/linux.zip',
    macarm: 'https://github.com/rejetto/thumbnails/raw/main/zip/macarm.zip',
    mac: 'https://github.com/rejetto/thumbnails/raw/main/zip/mac.zip',
    win: 'https://github.com/rejetto/thumbnails/raw/main/zip/win.zip',
}

exports.init = api => {
    api.log('sharp', Boolean(sharp))
    const { onOff } = api.require('./misc')
    const ramCache = new Map()
    const header = 'x-thumbnail'
    return {
        middleware(ctx) {
            return async () => {
                if (ctx.query.get !== 'thumb' || !ctx.body) return // !body includes 304 responses
                let buffer = await getFromStream(ctx.body, 96 * 1024)
                const thumb = readThumb(buffer)
                ctx.set(header, 'NOPE')
                if (thumb) {
                    ctx.set(header, 'embedded')
                    return ctx.body = thumb
                }
                const {size} = ctx.fileStats
                if (size < api.getConfig('fullThreshold') * 1024)
                    return ctx.redirect(ctx.state.revProxyPath + ctx.originalUrl.replace(/\?.+$/,''))
                if (fromCache()) return
                // generate new thumbnail
                buffer = await getFromStream(ctx.body, Infinity, { buffer }) // read the rest
                const w = Number(ctx.query.w) || THUMB_SIZE
                const h = Number(ctx.query.h)
                const quality = 60
                ctx.set(header, 'generated')
                const generated = sharp ? Buffer.from(await sharp(buffer).resize(w, h||w).jpeg({ quality }).toBuffer())
                    : await new Promise(async (resolve, reject) => { // fallback
                        const img = await Jimp.read(buffer)
                        img.scaleToFit(w, h).quality(quality).getBuffer('image/jpeg', (e, data) =>
                            e ? reject(e) : resolve(data))
                        ctx.set(header, 'generated-jimp')
                    })
                ctx.body = generated
                storeInCache(generated)
            }

            function fromCache() {
                //const cache = api.getConfig('cache')
                const thumb = ramCache.get(ctx.fileSource)
                if (!thumb) return
                ctx.set(header, 'cache')
                return ctx.body = thumb
            }

            function storeInCache(thumb) {
                ramCache.set(ctx.fileSource, thumb)
            }

        }
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
