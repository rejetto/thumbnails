const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const test = require('node:test')

test('limits requested dimensions without replacing the default cache', async () => {
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

function makeApi({ loadFileAttr, storeFileAttr, sharp, exif = false, head }) {
    return {
        storageDir: '/tmp/',
        getConfig: key => ({ log: false, pixels: 256, regenerateBefore: null, exif, fullThreshold: 0, quality: 20 })[key],
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
