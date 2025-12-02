'use strict';{
    const { h, t } = HFS
    const config = HFS.getPluginConfig()

    HFS.onEvent('entryIcon', ({ entry }) =>
        isSupported(entry) && h(ImgFallback, {
            fallback: () => entry.getDefaultIcon(),
            props: {
                src: entry.uri + '?get=thumb',
                className: 'icon thumbnail',
                loading: config.lazyLoading ? 'lazy' : undefined, // eager is default
                onMouseLeave() {
                    document.getElementById('thumbnailsPreview').innerHTML = ''
                },
                onMouseEnter(ev) {
                    if (!ev.target.closest('.dir')) return // only from within the file list, not (for example) when used as icon for the file-menu
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
                onLoadedMetadata,
                onMouseLeave() {
                    document.getElementById('thumbnailsPreview').innerHTML = ''
                },
                onMouseEnter(ev) {
                    if (HFS.state.tile_size) return
                    const el = ev.target.cloneNode(true)
                    el.addEventListener('loadedmetadata', onLoadedMetadata)
                    document.getElementById('thumbnailsPreview').replaceChildren(el)
                },
            }
        })
    )

    function onLoadedMetadata({ target: e }) {
        e.currentTime = 0
        e.addEventListener('seeked', async function handler() {
            if (e.currentTime < e.duration * 0.5 && await checkIfBlackFrame(e))
                return e.currentTime += e.duration * 0.05
            e.removeEventListener('seeked', handler)
        })
    }

    HFS.onEvent('afterList', () => "<div id='thumbnailsPreview'></div>" +
        "<style> #thumbnailsPreview { position: fixed; bottom: 0; right: 0; }" +
        "#thumbnailsPreview>* { width: 256px; height: auto; }" +
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

    function checkIfBlackFrame(video, {
        width = 160,
        height = 90,
        threshold = 30,
        blackRatio = 0.9
    } = {}) {
        return new Promise(resolve => {
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            const ctx = canvas.getContext('2d')
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
            let darkPixels = 0
            const totalPixels = canvas.width * canvas.height
            for (let i = 0; i < data.length; i += 4) {
                const r = data[i]
                const g = data[i + 1]
                const b = data[i + 2]
                if (r < threshold && g < threshold && b < threshold)
                    darkPixels++
            }
            resolve(darkPixels / totalPixels > blackRatio)
        });
    }
}
