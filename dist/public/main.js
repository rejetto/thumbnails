'use strict';{
    const { h, t } = HFS
    const config = HFS.getPluginConfig()

    HFS.onEvent('entryIcon', ({ entry }) =>
            isSupported(entry) && h(ImgFallback, {
                src: entry.uri + '?get=thumb',
                className: 'icon thumbnail',
                fallback: () => entry.getDefaultIcon(),
            })
            || config.videos && ['mp4', 'webm', 'mov', 'avi'].includes(entry.ext) && h(ImgFallback, {
                tag: 'video',
                src: entry.uri,
                className: 'icon thumbnail',
                disableRemotePlayback: true,
                fallback: () => entry.getDefaultIcon(),
            })
    )

    function ImgFallback({ fallback, tag='img', ...rest }) {
        const [err,setErr] = HFS.React.useState()
        return err ? fallback && h(fallback) : h(tag, {
            ...rest,
            onError() { setErr(true) }
        })
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
