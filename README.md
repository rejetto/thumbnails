# Thumbnails

HFS plugin to show thumbnails for images in place of icons. Works best on "tiles mode" (enable it in frontend's options).

First install the required plugin "sharp by rejetto".

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
