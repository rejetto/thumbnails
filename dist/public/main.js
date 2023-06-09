{
    const { h } = HFS

    HFS.onEvent('entryIcon', ({ entry }) =>
        isSupported(entry) && h(ImgFallback, {
            src: entry.uri + '?get=thumb',
            className: 'icon thumbnail',
            fallback: () => entry.getDefaultIcon()
        })
    )

    function ImgFallback({ fallback, ...rest }) {
        const [err,setErr] = HFS.React.useState()
        return err ? h(fallback) : h('img', {
            ...rest,
            onError() { setErr(true) }
        })
    }

    HFS.onEvent('fileMenu', ({ entry }) =>
        !HFS.state.tiles && isSupported(entry) && [{
            icon: '⚃',
            label: "Enable tiles mode",
            onClick() {
                HFS.state.tiles = 10
                setTimeout(() => // give some time to see effect
                    HFS.dialogLib.alertDialog("To switch back, click Options"), 1000)
            }
        }] )

    function isSupported(entry) {
        return entry._th // calculated server-side
            || /jpe?g|png|webp|tiff?/.test(entry.ext)
            || HFS.emit('thumbnails_supported', { entry }).some(Boolean)
    }
}
