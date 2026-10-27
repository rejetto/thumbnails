const { buildSync } = require('esbuild')
const fs = require('node:fs')
const path = require('node:path')

const result = buildSync({
    stdin: {
        contents: `import { createJimp } from '@jimp/core'
            import jpeg from '@jimp/js-jpeg'
            import png from '@jimp/js-png'
            import gif from '@jimp/js-gif'
            import tiff from '@jimp/js-tiff'
            import { methods } from '@jimp/plugin-resize'
            module.exports = createJimp({ formats: [jpeg, png, gif, tiff], plugins: [methods] })`,
        resolveDir: __dirname + '/..',
    },
    bundle: true,
    metafile: true,
    minify: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/jimp.min.js',
    legalComments: 'eof',
    logLevel: 'info',
})

// retain license notices for every dependency actually included in the standalone bundle
const licenses = new Map()
for (const input of Object.keys(result.metafile.inputs)) {
    if (!input.includes('node_modules/')) continue
    let dir = path.dirname(path.resolve(input))
    let pkg
    while (!pkg?.name) {
        if (fs.existsSync(path.join(dir, 'package.json')))
            pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
        if (!pkg?.name) dir = path.dirname(dir)
    }
    if (licenses.has(dir)) continue
    // omggif ships its MIT notice in the source header instead of a separate license file
    const file = fs.readdirSync(dir).find(name => /^licen[cs]e(?:\.|$)/i.test(name))
        || (pkg.name === 'omggif' ? 'omggif.js' : undefined)
    if (!file) throw Error('Missing license for ' + pkg.name)
    let notice = fs.readFileSync(path.join(dir, file), 'utf8')
    if (pkg.name === 'omggif') notice = notice.split('\n"use strict";')[0]
    licenses.set(dir, pkg.name + ' ' + pkg.version + '\n' + notice)
}
fs.writeFileSync('dist/jimp.LICENSE.txt', [...licenses.values()].join('\n\n'))
