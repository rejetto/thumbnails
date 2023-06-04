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