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

  // Keep viewport sized to container
  useEffect(() => {
    if (!rootRef.current) return
    const engine = engineRef.current
    const ro = new ResizeObserver(() => {
      try {
        engine?.resize()         // notify Cornerstone about size change
        vpRef.current?.render()
      } catch {}
    })
    ro.observe(rootRef.current)
    return () => ro.disconnect()
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

        // Ensure the panel has some height before enabling
        // (defensive: if parent layout forgot to give height)
        if (element.clientHeight < 2) {
          element.style.minHeight = '400px'   // fallback to something visible
        }

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

        // Wait for layout to apply, then ensure Cornerstone reads sizes
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

  return (
    <div
      ref={rootRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,       // allow child to grow
        height: '100%',     // fill available space
        width: '100%',
      }}
    >
      <div style={{ padding: 6, borderBottom: '1px solid #222' }}>
        <span>3D Volume</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div
          ref={elRef}
          className="viewer3d__viewport"
          tabIndex={0}
          style={{ flex: 1, outline: 'none', minHeight: 0 }}
        />
      </div>

      <div style={{ padding: 6, height: 28 }}>
        {error && <span style={{ color: '#f66' }}>Error: {error}</span>}
        {!error && !ready && <span>Loading…</span>}
      </div>
    </div>
  )
}
