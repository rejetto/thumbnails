const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const test = require('node:test')
const Jimp = require('../dist/jimp.min')

// a real HFS process verifies that a missing native library does not block dependent plugins
const hfs = process.env.HFS_ROOT || path.resolve(__dirname, '../../../hfs')
test('serves and caches thumbnails in HFS when the Sharp binary is missing', { timeout: 30_000 }, async t => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'hfs-thumbnails-'))
    const shared = path.join(cwd, 'files')
    await fs.mkdir(shared)
    const image = new Jimp({ width: 80, height: 40, color: 0xff0000ff })
    await fs.writeFile(path.join(shared, 'image.png'), await image.getBuffer('image/png'))
    await fs.mkdir(path.join(cwd, 'plugins/sharp'), { recursive: true })
    await fs.cp(path.resolve(__dirname, '../dist'), path.join(cwd, 'plugins/thumbnails'), { recursive: true })
    const sharpDist = path.resolve(__dirname, '../../sharp/dist')
    for (const name of ['plugin.js', 'sharp-runner.js'])
        await fs.copyFile(path.join(sharpDist, name), path.join(cwd, 'plugins/sharp', name))
    await fs.mkdir(path.join(cwd, 'plugins/sharp/node_modules/sharp'), { recursive: true })
    await fs.writeFile(path.join(cwd, 'plugins/sharp/node_modules/sharp/index.js'),
        "module.exports = require('./missing-platform.node')")
    await fs.writeFile(path.join(cwd, 'config.yaml'), JSON.stringify({
        port: 0, https_port: -1, listen_interface: '127.0.0.1',
        open_browser_at_start: false, localhost_admin: true, log: '', error_log: '',
        enable_plugins: ['sharp', 'thumbnails'],
        plugins_config: { thumbnails: { fullThreshold: 0, pixels: 32, exif: false } },
        vfs: { children: [{ name: 'files', source: shared }] },
    }))
    const child = spawn(process.execPath, [path.join(hfs, 'dist/src/index.js'), '--cwd', cwd, '--no-central'], {
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let logs = ''
    child.stdout.on('data', chunk => { logs += chunk })
    child.stderr.on('data', chunk => { logs += chunk })
    t.after(async () => {
        child.kill()
        if (child.exitCode === null) await once(child, 'exit')
        await fs.writeFile(path.join(cwd, 'server.log'), logs)
        t.diagnostic('HFS validation files: ' + cwd)
    })
    let base, plugins
    for (let i = 0; i < 200; i++) {
        assert.equal(child.exitCode, null, logs)
        base = /Serving on (http:\/\/127\.0\.0\.1:\d+)/.exec(logs)?.[1]
        if (base) {
            const response = await fetch(base + '/~/api/get_plugins', { headers: { 'x-hfs-anti-csrf': '1' } })
            plugins = (await response.json()).list
            if (plugins.some(x => x.id === 'thumbnails' && x.started)) break
        }
        await delay(50)
    }
    assert.ok(plugins?.some(x => x.id === 'thumbnails' && x.started), logs)
    assert.ok(plugins.some(x => x.id === 'sharp' && x.started), logs)
    assert.ok(logs.includes('missing-platform.node'), logs)
    const first = await fetch(base + '/files/image.png?get=thumb')
    assert.equal(first.status, 200)
    assert.equal(first.headers.get('content-type'), 'image/jpeg')
    assert.equal(first.headers.get('x-thumbnail'), 'generated')
    const bytes = Buffer.from(await first.arrayBuffer())
    const thumbnail = await Jimp.read(bytes)
    assert.deepEqual([thumbnail.bitmap.width, thumbnail.bitmap.height], [32, 16])
    const second = await fetch(base + '/files/image.png?get=thumb')
    assert.equal(second.headers.get('x-thumbnail'), 'cache')
    assert.equal(second.headers.get('content-type'), 'image/jpeg')
    assert.deepEqual(Buffer.from(await second.arrayBuffer()), bytes)
})
