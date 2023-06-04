# Extendable

This plugin is extendable: other plugins can add support for more formats without having to care of all details,
just the minimum.
Let's say you want to create a plugin that adds PDF support to thumbnails. You should

1. Define a frontend_js with
```js
HFS.onEvent('thumbnails_supported', ({ entry }) =>
    entry.n.endsWith('.pdf') )
```

2. In plugin.js, export
```js
    exports.customApi = {
        thumbnails_get({ ctx, path }) {
            if (path.endsWith('.pdf')) {
                const thumbnailImage = ...your code to generate the thumbnail
                return thumbnailImage
            }
        }
    }
```

