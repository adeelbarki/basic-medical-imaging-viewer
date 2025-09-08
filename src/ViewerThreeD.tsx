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

// --- NEW: Cornerstone Tools imports ---
import {
  init as csToolsInit,
  ToolGroupManager,
  addTool,
  PanTool,
  ZoomTool,
  TrackballRotateTool,
  VolumeRotateTool,
  Enums as csToolsEnums,
} from '@cornerstonejs/tools'

type Props = { imageIds: string[] }

const ENGINE_ID = 'ENGINE_SHARED'
const VIEWPORT_ID = 'VP_3D'
const VOLUME_ID_BASE = 'cornerstoneStreamingImageVolume:study-3d'
const TOOLGROUP_ID = 'TG_3D'

/* ---------------- Transfer Function Presets (simple CT examples) ---------------- */
type TFNode = { x: number; r: number; g: number; b: number; a: number } // x in HU, r/g/b/a in 0..1

const TF_PRESETS = {
  'CT Soft Tissue': [
    { x: -1000, r: 0.00, g: 0.00, b: 0.00, a: 0.00 },
    { x:  -200, r: 0.10, g: 0.10, b: 0.40, a: 0.05 },
    { x:    40, r: 0.95, g: 0.70, b: 0.40, a: 0.15 },
    { x:   300, r: 1.00, g: 0.95, b: 0.85, a: 0.60 },
    { x:  2000, r: 1.00, g: 0.98, b: 0.95, a: 0.90 },
  ],
  'CT Bone': [
    { x: -1000, r: 0.00, g: 0.00, b: 0.00, a: 0.00 },
    { x:   100, r: 0.70, g: 0.50, b: 0.30, a: 0.00 },
    { x:   300, r: 0.90, g: 0.80, b: 0.60, a: 0.25 },
    { x:  1000, r: 1.00, g: 1.00, b: 1.00, a: 0.65 },
    { x:  3000, r: 1.00, g: 1.00, b: 1.00, a: 0.95 },
  ],
  'CT Lung': [
    { x: -1000, r: 0.00, g: 0.00, b: 0.00, a: 0.00 },
    { x:  -900, r: 0.20, g: 0.45, b: 0.80, a: 0.05 },
    { x:  -750, r: 0.30, g: 0.75, b: 0.95, a: 0.12 },
    { x:  -500, r: 0.85, g: 0.95, b: 0.95, a: 0.18 },
    { x:  1000, r: 1.00, g: 1.00, b: 1.00, a: 0.30 },
  ],
} as const
type PresetName = keyof typeof TF_PRESETS

/* ---------------- Blend Mode ---------------- */
type BlendMode = 'VR (Composite)' | 'MIP (Max Intensity)'

/* -------- Helpers to work across CS3D versions (viewport vs vtk actor) -------- */
function getVolumeActorEntry(vp: any, volumeId?: string) {
  const entries = (typeof vp.getActors === 'function') ? vp.getActors() : []
  if (!entries?.length) return undefined
  if (volumeId) return entries.find((e: any) => e?.uid === volumeId) ?? entries[0]
  return entries[0]
}

function setCompositeBlend(vp: any, entry?: any) {
  if (typeof vp.setBlendMode === 'function') {
    vp.setBlendMode(Enums.BlendModes.COMPOSITE)
  } else if (entry?.mapper?.setBlendModeToComposite) {
    entry.mapper.setBlendModeToComposite()
  }
}

function setMIPBlend(vp: any, entry?: any) {
  if (typeof vp.setBlendMode === 'function') {
    vp.setBlendMode(Enums.BlendModes.MAXIMUM_INTENSITY_BLEND)
  } else if (entry?.mapper?.setBlendModeToMaximumIntensity) {
    entry.mapper.setBlendModeToMaximumIntensity()
  }
}

/* ---- Apply colored TF for Composite; grayscale/MIP ignores TF color by design ---- */
function applyAppearance(
  vp: Types.IVolumeViewport,
  volumeId: string,
  preset: PresetName,
  mode: BlendMode
) {
  const anyVp = vp as any
  const entry = getVolumeActorEntry(anyVp, volumeId)
  const vtkVol = entry?.actor ?? entry
  const prop = vtkVol?.getProperty?.()
  const mapper = entry?.mapper ?? vtkVol?.getMapper?.()

  if (!prop || !mapper) return

  if (mode === 'VR (Composite)') {
    setCompositeBlend(anyVp, { mapper })
    const nodes = TF_PRESETS[preset]
    const ctf = prop.getRGBTransferFunction(0)
    const sof = prop.getScalarOpacity(0)
    ctf?.removeAllPoints?.()
    sof?.removeAllPoints?.()
    nodes.forEach((n) => {
      ctf.addRGBPoint(n.x, n.r, n.g, n.b)
      sof.addPoint(n.x, n.a)
    })
  } else {
    setMIPBlend(anyVp, { mapper })
    const ctf = prop.getRGBTransferFunction(0)
    const sof = prop.getScalarOpacity(0)
    ctf?.removeAllPoints?.()
    sof?.removeAllPoints?.()
    ctf.addRGBPoint(-1000, 0.0, 0.0, 0.0)
    ctf.addRGBPoint(   100, 0.4, 0.4, 0.4)
    ctf.addRGBPoint(  1500, 1.0, 1.0, 1.0)
    sof.addPoint(-1000, 0.00)
    sof.addPoint(   100, 0.02)
    sof.addPoint(   300, 0.08)
    sof.addPoint(   700, 0.20)
    sof.addPoint(  1200, 0.60)
    sof.addPoint(  3000, 0.95)
  }

  vp.render()
}

// Ensure Tools is initialized once (safe to call repeatedly)
let toolsReady = false
function ensureTools() {
  if (!toolsReady) {
    csToolsInit() // initialize @cornerstonejs/tools
    // Register the tools we need once
    addTool(TrackballRotateTool)
    addTool(PanTool)
    addTool(ZoomTool)
    addTool(VolumeRotateTool)
    toolsReady = true
  }
}

export default function ViewerThreeD({ imageIds }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const elRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<RenderingEngine | null>(null)
  const vpRef = useRef<Types.IVolumeViewport | null>(null)
  const volumeIdRef = useRef<string | null>(null)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<PresetName>('CT Soft Tissue')
  const [blend, setBlend] = useState<BlendMode>('VR (Composite)')

  async function waitForNonZeroSize(el: HTMLElement, maxFrames = 30) {
    for (let i = 0; i < maxFrames; i++) {
      if (el.clientWidth > 1 && el.clientHeight > 1) return
      await raf()
    }
  }

  // Keep viewport sized to container
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(() => {
      try { engineRef.current?.resize(); vpRef.current?.render() } catch {}
    })
    ro.observe(root)
    const onWin = () => { try { engineRef.current?.resize(); vpRef.current?.render() } catch {} }
    window.addEventListener('resize', onWin)
    return () => { ro.disconnect(); window.removeEventListener('resize', onWin) }
  }, [])

  // Build & render 3D volume + attach tools
  useEffect(() => {
    let destroyed = false
    ;(async () => {
      try {
        await initCornerstone()
        ensureTools() // <— Tools init + tool registration
        if (destroyed) return

        setUseCPURendering(false)

        const engine = getRenderingEngine(ENGINE_ID) ?? new RenderingEngine(ENGINE_ID)
        engineRef.current = engine

        const element = elRef.current
        if (!element) throw new Error('Viewport element not mounted')

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

        await raf()
        engine.resize()

        const VOLUME_ID = `${VOLUME_ID_BASE}-${goodIds.length}`
        volumeIdRef.current = VOLUME_ID

        const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, { imageIds: goodIds })
        await volume.load()

        const vvp = engine.getViewport(VIEWPORT_ID) as Types.IVolumeViewport
        vpRef.current = vvp

        await vvp.setVolumes([{ volumeId: VOLUME_ID }])
        vvp.resetCamera()

        // ----- NEW: ToolGroup wiring (bind this viewport) -----
        let tg = ToolGroupManager.getToolGroup(TOOLGROUP_ID)
        if (!tg) tg = ToolGroupManager.createToolGroup(TOOLGROUP_ID)

        // Add tools (idempotent)
        try { tg.addTool(TrackballRotateTool.toolName) } catch {}
        try { tg.addTool(PanTool.toolName) } catch {}
        try { tg.addTool(ZoomTool.toolName) } catch {}
        try { tg.addTool(VolumeRotateTool.toolName) } catch {}

        // Bind this viewport to the group
        try { tg.addViewport(VIEWPORT_ID, ENGINE_ID) } catch {}

        // Set active bindings: left=rotate, middle=pan, right=zoom, wheel=rotate
        tg.setToolActive(TrackballRotateTool.toolName, {
          bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
        })
        tg.setToolActive(PanTool.toolName, {
          bindings: [{ mouseButton: csToolsEnums.MouseBindings.Auxiliary }],
        })
        tg.setToolActive(ZoomTool.toolName, {
          bindings: [{ mouseButton: csToolsEnums.MouseBindings.Secondary }],
        })
        tg.setToolActive(VolumeRotateTool.toolName, {
          bindings: [{ mouseWheel: true }],
        })
        // ------------------------------------------------------

        // Apply initial appearance (Composite + preset by default)
        applyAppearance(vvp, VOLUME_ID, preset, blend)

        setError(null)
        setReady(true)
      } catch (e: any) {
        console.error(e)
        setError(String(e?.message ?? e))
      }
    })()

    return () => {
      destroyed = true
      // Optional: remove this viewport from the toolgroup on unmount
      try {
        const tg = ToolGroupManager.getToolGroup(TOOLGROUP_ID)
        tg?.removeViewports?.([VIEWPORT_ID]) || tg?.removeViewport?.(VIEWPORT_ID, ENGINE_ID)
      } catch {}
      const eng = engineRef.current
      if (eng) { try { eng.disableElement(VIEWPORT_ID) } catch {} }
      vpRef.current = null
      volumeIdRef.current = null
    }
  }, [imageIds])

  // Re-apply TF/blend when user changes settings
  useEffect(() => {
    const vp = vpRef.current
    const volId = volumeIdRef.current
    if (!vp || !volId) return
    try { applyAppearance(vp, volId, preset, blend) } catch {}
  }, [preset, blend])

  // ---- Shell with shared classes ----
  return (
    <div className="viewerPane" ref={rootRef}>
      <div className="viewerPane__header" style={{ gap: 8 }}>
        <div>3D Volume</div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ opacity: 0.8 }}>Blend</label>
          <select
            value={blend}
            onChange={(e) => setBlend(e.target.value as BlendMode)}
            style={{ background: '#1a1a1a', color: '#ddd', border: '1px solid #333', borderRadius: 6, padding: '4px 8px' }}
          >
            <option>VR (Composite)</option>
            <option>MIP (Max Intensity)</option>
          </select>

          <label style={{ opacity: 0.8 }}>Preset</label>
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as PresetName)}
            disabled={blend === 'MIP (Max Intensity)'}
            style={{ background: '#1a1a1a', color: '#ddd', border: '1px solid #333', borderRadius: 6, padding: '4px 8px' }}
          >
            {Object.keys(TF_PRESETS).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
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
