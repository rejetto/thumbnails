const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const test = require('node:test')

test('limits requested dimensions without replacing the default cache', async () => {
    assert.equal(require.cache[require.resolve('../dist/jimp.min')], undefined)
    const resized = []
    const loadedKeys = []
    const stored = []
    const api = makeApi({
        loadFileAttr: async (_, key) => {
            loadedKeys.push(key)
            return { ts: 1, thumbTs: new Date(), mime: 'image/jpeg', w: 256, h: 256, base64: 'b2xk' }
        },
        storeFileAttr: async (...args) => stored.push(args),
        sharp: {
            resize(w, h) { resized.push([w, h]); return this },
            rotate() { return this },
            jpeg() { return this },
            async toBuffer() { return Buffer.from('jpeg') },
        },
    })
    const middleware = (await require('../dist/plugin.js').init(api)).middleware
    const ctx = makeCtx({ w: '999999', h: '4000' })

    await middleware(ctx)()

    assert.equal(require.cache[require.resolve('../dist/jimp.min')], undefined)
    assert.deepEqual(resized, [[2000, 2000]])
    assert.deepEqual(loadedKeys, ['thumbnail'])
    assert.equal(ctx.type, 'image/jpeg')
    assert.deepEqual(stored, [])
})

test('uses the default cache for a matching requested size', async () => {
    const api = makeApi({
        loadFileAttr: async () => ({
            ts: 1, thumbTs: new Date(), mime: 'image/jpeg', w: 128, h: 128, base64: 'eA=='
        }),
        storeFileAttr: async () => {},
    })
    const middleware = (await require('../dist/plugin.js').init(api)).middleware
    const ctx = makeCtx({ w: '128', h: '128' })

    await middleware(ctx)()

    assert.equal(ctx.body.toString(), 'x')
})

test('restores the cached MIME type', async () => {
    const loadedKeys = []
    const api = makeApi({
        loadFileAttr: async (_, key) => {
            loadedKeys.push(key)
            return { ts: 1, thumbTs: new Date(), mime: 'image/jpeg', base64: 'eA==' }
        },
        storeFileAttr: async () => {},
    })
    const middleware = (await require('../dist/plugin.js').init(api)).middleware
    const ctx = makeCtx({})

    await middleware(ctx)()

    assert.equal(ctx.type, 'image/jpeg')
    assert.equal(ctx.body.toString(), 'x')
    assert.deepEqual(loadedKeys, ['thumbnail'])
})

test('extracts an embedded JPEG using binary markers', async () => {
    const embedded = Buffer.from([0xFF, 0xD8, 0xFF, 1, 2, 0xFF, 0xD9])
    const api = makeApi({
        loadFileAttr: async () => {},
        storeFileAttr: async () => {},
        exif: true,
        head: Buffer.concat([Buffer.from([1, 2]), embedded, Buffer.from([3, 4])]),
    })
    const middleware = (await require('../dist/plugin.js').init(api)).middleware
    const ctx = makeCtx({})

    await middleware(ctx)()

    assert.deepEqual(ctx.body, embedded)
    assert.equal(ctx.type, 'image/jpeg')
})

test('uses an embedded thumbnail above the size limit even when EXIF is disabled', async () => {
    const embedded = Buffer.from([0xFF, 0xD8, 0xFF, 1, 2, 0xFF, 0xD9])
    const api = makeApi({
        loadFileAttr: async () => {},
        storeFileAttr: async () => {},
        head: Buffer.concat([Buffer.from([1, 2]), embedded]),
    })
    const middleware = (await require('../dist/plugin.js').init(api)).middleware
    const ctx = makeCtx({})
    ctx.state.fileStats.size = 101 * 1024 * 1024

    await middleware(ctx)()

    assert.deepEqual(ctx.body, embedded)
})

test('rejects generation above the size limit without reading the original', async () => {
    const api = makeApi({
        loadFileAttr: async () => {},
        storeFileAttr: async () => {},
        head: Buffer.from('no embedded thumbnail'),
    })
    const middleware = (await require('../dist/plugin.js').init(api)).middleware
    const ctx = makeCtx({})
    ctx.state.fileStats.size = 101 * 1024 * 1024
    ctx.body = new Readable({ read() { assert.fail('read original') } })

    await middleware(ctx)()

    assert.equal(ctx.status, 413)
    assert.equal(ctx.type, 'text')
})

for (const mime of ['image/jpeg', 'image/png', 'image/gif', 'image/tiff']) {
    test(`generates and caches a JPEG from ${mime} without Sharp`, async () => {
        const Jimp = require('../dist/jimp.min')
        const source = await new Jimp({ width: 80, height: 40, color: 0xff0000ff }).getBuffer(mime)
        let cached
        const api = makeApi({
            loadFileAttr: async () => cached,
            storeFileAttr: async (_, key, value) => { cached = value },
            pixels: 32,
        })
        const middleware = (await require('../dist/plugin.js').init(api)).middleware
        const ctx = makeCtx({})
        ctx.body = Readable.from(source)
        await middleware(ctx)()

        const image = await Jimp.read(ctx.body)
        assert.equal(ctx.type, 'image/jpeg')
        assert.deepEqual([image.bitmap.width, image.bitmap.height], [32, 16])
        assert.ok(image.bitmap.data[0] > 200)
        assert.ok(image.bitmap.data[1] < 30)
        assert.equal(cached.mime, 'image/jpeg')
        const second = makeCtx({})
        await middleware(second)()
        assert.deepEqual(second.body, ctx.body)
    })
}

test('applies EXIF orientation before fitting the requested dimensions', async () => {
    const Jimp = require('../dist/jimp.min')
    const jpeg = await new Jimp({ width: 80, height: 40, color: 0xff0000ff }).getBuffer('image/jpeg')
    // EXIF orientation 6 rotates the stored landscape image into portrait
    const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000', 'hex')
    const source = Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)])
    const api = makeApi({ loadFileAttr: async () => {}, storeFileAttr: async () => {} })
    const middleware = (await require('../dist/plugin.js').init(api)).middleware
    const ctx = makeCtx({ w: 30, h: 50 })
    ctx.body = Readable.from(source)
    await middleware(ctx)()

    const image = await Jimp.read(ctx.body)
    assert.deepEqual([image.bitmap.width, image.bitmap.height], [25, 50])
})

test('reports an invalid image without caching it', async () => {
    let stored = false
    const api = makeApi({
        loadFileAttr: async () => {},
        storeFileAttr: async () => { stored = true },
    })
    const middleware = (await require('../dist/plugin.js').init(api)).middleware
    const ctx = makeCtx({})
    await middleware(ctx)()

    assert.equal(ctx.status, 501)
    assert.equal(ctx.type, 'text')
    assert.equal(stored, false)
})

function makeApi({ loadFileAttr, storeFileAttr, sharp, exif = false, head, pixels = 256,
    largeFileThreshold = 100 }) {
    return {
        storageDir: '/tmp/',
        log() {},
        getConfig: key => ({ log: false, pixels, regenerateBefore: null, exif, fullThreshold: 0, quality: 20,
            largeFileThreshold })[key],
        require(name) {
            if (name === 'fs') return { createReadStream: () => Readable.from(head), rm(_, __, cb) { cb() } }
            if (name === 'node:stream/consumers') return require(name)
            if (name === './misc') return { loadFileAttr, storeFileAttr }
            throw new Error(`unexpected module ${name}`)
        },
        customApiCall(name) {
            if (name === 'thumbnails_get') return []
            if (name === 'sharp') return sharp ? [sharp] : []
            throw new Error(`unexpected API ${name}`)
        },
    }
}

function makeCtx(query) {
    return {
        query: { get: 'thumb', ...query },
        state: { fileSource: '/share/image.png', fileStats: { size: 1000, mtimeMs: 1 } },
        body: Readable.from(Buffer.from('source')),
        set() {},
        type: 'image/png',
    }
}
