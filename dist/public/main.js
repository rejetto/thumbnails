'use strict';{
    const { h, t } = HFS
    const config = HFS.getPluginConfig()

    HFS.onEvent('entryIcon', ({ entry }) =>
            isSupported(entry) && h(ImgFallback, {
                fallback: () => entry.getDefaultIcon(),
                props: {
                    src: entry.uri + '?get=thumb',
                    className: 'icon thumbnail',
                    onMouseLeave() {
                        document.getElementById('thumbnailsPreview').innerHTML = ''
                    },
                    onMouseEnter() {
                        if (!HFS.state.tile_size)
                            document.getElementById('thumbnailsPreview').innerHTML = "<img src='" + entry.uri + "?get=thumb'/>"
                    },
                }
            })
            || config.videos && ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(entry.ext) && h(ImgFallback, {
                fallback: () => entry.getDefaultIcon(),
                tag: 'video',
                props: {
                    src: entry.uri,
                    className: 'icon thumbnail',
                    disableRemotePlayback: true,
                    onMouseLeave() {
                        document.getElementById('thumbnailsPreview').innerHTML = ''
                    },
                    onMouseEnter() {
                        if (!HFS.state.tile_size)
                            document.getElementById('thumbnailsPreview').innerHTML = "<video src='" + entry.uri + "'/>"
                    },
                }
            })
    )

    HFS.onEvent('afterList', () => "<div id='thumbnailsPreview'></div>" +
        "<style> #thumbnailsPreview { position: fixed; bottom: 0; right: 0; }" +
        "#thumbnailsPreview>* { max-height: 256px; max-width: 256px; }" +
        "</style>")

    function ImgFallback({ fallback, tag='img', props }) {
        const [err,setErr] = HFS.React.useState()
        return err ? fallback && h(fallback) : h(tag, Object.assign(props, {
            onError() { setErr(true) }
        }))
    }

    HFS.onEvent('fileMenu', ({ entry }) =>
        config.showTilesInMenu && !HFS.state.tile_size && isSupported(entry) && [{
            icon: '⊞',
            label: t("Enable tiles mode"),
            onClick() {
                HFS.state.tile_size = 10
                setTimeout(() => // give some time to see effect
                    HFS.dialogLib.alertDialog(t('thumbnails_switchBack', "To switch back, click Options")), 1000)
            }
        }] )

    function isSupported(entry) {
        return entry._th // calculated server-side
            || ['jpg','jpeg','png','webp','tiff','tif','gif','avif','svg'].includes(entry.ext)
            || HFS.emit('thumbnails_supported', { entry }).some(Boolean)
    }
}
