// ViewerThreeD.tsx
import { useEffect, useRef, useState } from 'react'
import {
  RenderingEngine,
  Enums,
  type Types,
  getRenderingEngine,
  setUseCPURendering,
  volumeLoader,
} from '@cornerstonejs/core'
import { initCornerstone } from './cornerstoneInit'
import { prefetchPlaneMeta, buildMprImageIds, raf } from './utils/helpers/mprUtils'
import './Viewer-shell.css'

type Props = { imageIds: string[] }

const ENGINE_ID = 'ENGINE_SHARED'
const VIEWPORT_ID = 'VP_3D'
const VOLUME_ID_BASE = 'cornerstoneStreamingImageVolume:study-3d'

export default function ViewerThreeD({ imageIds }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const elRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<RenderingEngine | null>(null)
  const vpRef = useRef<Types.IVolumeViewport | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Wait until element has non-zero size (tabs/grid can start collapsed)
  async function waitForNonZeroSize(el: HTMLElement, maxFrames = 30) {
    for (let i = 0; i < maxFrames; i++) {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 1 && h > 1) return
      await raf()
    }
  }

  // Keep viewport sized to container
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const ro = new ResizeObserver(() => {
      try {
        engineRef.current?.resize()
        vpRef.current?.render()
      } catch {}
    })
    ro.observe(root)

    const onWinResize = () => {
      try {
        engineRef.current?.resize()
        vpRef.current?.render()
      } catch {}
    }
    window.addEventListener('resize', onWinResize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWinResize)
    }
  }, [])

  useEffect(() => {
    let destroyed = false
    ;(async () => {
      try {
        await initCornerstone()
        if (destroyed) return

        setUseCPURendering(false)

        const engine = getRenderingEngine(ENGINE_ID) ?? new RenderingEngine(ENGINE_ID)
        engineRef.current = engine

        const element = elRef.current
        if (!element) throw new Error('Viewport element not mounted')

        // Ensure layout has assigned real size before enabling Cornerstone
        await waitForNonZeroSize(element)
        if (destroyed) return

        await prefetchPlaneMeta(imageIds)
        const { goodIds, reason } = buildMprImageIds(imageIds)
        if (goodIds.length < 3) {
          setError(reason ?? 'Insufficient slices to build 3D volume.')
          setReady(true)
          return
        }

        try { engine.disableElement(VIEWPORT_ID) } catch {}

        engine.enableElement({
          viewportId: VIEWPORT_ID,
          type: Enums.ViewportType.VOLUME_3D,
          element,
          defaultOptions: { background: [0, 0, 0] },
        })

        // Sync Cornerstone with actual DOM size
        await raf()
        engine.resize()

        const VOLUME_ID = `${VOLUME_ID_BASE}-${goodIds.length}`
        const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, { imageIds: goodIds })
        await volume.load()

        const vvp = engine.getViewport(VIEWPORT_ID) as Types.IVolumeViewport
        vpRef.current = vvp

        await vvp.setVolumes([{ volumeId: VOLUME_ID }])
        vvp.resetCamera()
        vvp.render()

        setError(null)
        setReady(true)
      } catch (e: any) {
        console.error(e)
        setError(String(e?.message ?? e))
      }
    })()

    return () => {
      destroyed = true
      const eng = engineRef.current
      if (eng) {
        try { eng.disableElement(VIEWPORT_ID) } catch {}
      }
      vpRef.current = null
    }
  }, [imageIds])

  // ---- Shell with shared classes ----
  return (
    <div className="viewerPane" ref={rootRef}>
      <div className="viewerPane__header">
        <div>3D Volume</div>
        {/* TODO: add TF presets / MIP toggle / rotate tools */}
      </div>

      <div className="viewerPane__fill">
        <div ref={elRef} className="viewerPane__viewport" tabIndex={0} />
      </div>

      <div className="viewerPane__status">
        {error ? <span style={{ color: '#f66' }}>{error}</span> : ready ? null : 'Loading…'}
      </div>
    </div>
  )
}
