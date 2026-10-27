# Thumbnails

HFS plugin to show thumbnails for images in place of icons. Works best on "tiles mode" (enable it in frontend's options).

The "sharp" plugin is used when its native library is available. If it cannot load (for example, because its native binary is unavailable for your platform), Thumbnails uses the bundled JavaScript engine Jimp instead. The Sharp plugin is installed automatically; version 1.4 or newer allows Thumbnails to start even when the native library is unavailable.

Requires HFS 0.51.0 or newer and Node.js 18 or newer.

The Jimp fallback supports JPEG, PNG, GIF and TIFF, including JPEG EXIF orientation. WebP, AVIF and SVG generation requires Sharp. Existing embedded thumbnails, cached thumbnails and original-file passthrough still work as before.

## Installation

In HFS Admin, open **Plugins → Get more**, search for **thumbnails** and install it. Return to the installed plugins list and click the **Options button on the Thumbnails row** to configure it.

## Development

Run `npm ci` and `npm run build` to rebuild `dist/jimp.min.js`, the standalone minified Jimp 1.6.1 bundle. Only image codecs and resizing are included; no runtime npm installation is needed. Run `npm test` for generation tests and an integration test using a real HFS build from `../hfs` (override its checkout path with `HFS_ROOT`).

For local HFS development, link this repository's `dist` directory as `~/.hfs/plugins/thumbnails`.

<img width="700" alt="image" src="https://github.com/rejetto/thumbnails/assets/1367199/d74a8a24-a6f8-4460-93de-74d9d6bd413f">

# Extendable

This plugin is extendable: other plugins can add support for more formats without having to care of all details,
just the minimum.
Let's say you want to create a plugin that adds PDF support to thumbnails. You should do something like:
```js
exports.onDirEntry = ({entry}) => {
    if (entry.n.endsWith('.pdf'))
        entry._th = 1
}

exports.customApi = {
    thumbnails_get({ ctx, path }) {
        if (path.endsWith('.pdf')) {
            const thumbnailImage = ...your code to generate the thumbnail
            return thumbnailImage
        }
    }
}
```

There's an alternative way to the `onDirEntry`, and it's to define a `frontend_js` with this 
```js
HFS.onEvent('thumbnails_supported', ({ entry }) =>
    entry.n.endsWith('.pdf') )
``` 
