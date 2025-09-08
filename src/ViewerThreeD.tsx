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
    // 1) Blend: Composite
    setCompositeBlend(anyVp, { mapper })

    // 2) Transfer function nodes
    const nodes = TF_PRESETS[preset]
    const ctf = prop.getRGBTransferFunction(0)
    const sof = prop.getScalarOpacity(0)
    if (ctf?.removeAllPoints) ctf.removeAllPoints()
    if (sof?.removeAllPoints) sof.removeAllPoints()
    nodes.forEach((n) => {
      ctf.addRGBPoint(n.x, n.r, n.g, n.b)
      sof.addPoint(n.x, n.a)
    })
  } else {
    // MIP: Ignore color TF; emphasize bright structures
    setMIPBlend(anyVp, { mapper })

    // Give MIP a sensible grayscale and opacity ramp in HU
    const ctf = prop.getRGBTransferFunction(0)
    const sof = prop.getScalarOpacity(0)
    if (ctf?.removeAllPoints) ctf.removeAllPoints()
    if (sof?.removeAllPoints) sof.removeAllPoints()

    // Grayscale ramp (window ~ [100, 1500] HU)
    ctf.addRGBPoint(-1000, 0.0, 0.0, 0.0)
    ctf.addRGBPoint(   100, 0.4, 0.4, 0.4)
    ctf.addRGBPoint(  1500, 1.0, 1.0, 1.0)

    // Opacity: very low until soft tissue, then steeper into bone
    sof.addPoint(-1000, 0.00)
    sof.addPoint(   100, 0.02)
    sof.addPoint(   300, 0.08)
    sof.addPoint(   700, 0.20)
    sof.addPoint(  1200, 0.60)
    sof.addPoint(  3000, 0.95)
  }

  vp.render()
}

/* ---------------- Vector/Camera math for orbit/zoom ---------------- */
type Vec3 = [number, number, number]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0]+b[0], a[1]+b[1], a[2]+b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]]
const mul = (a: Vec3, s: number): Vec3 => [a[0]*s, a[1]*s, a[2]*s]
const dot = (a: Vec3, b: Vec3) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [ a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0] ]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: Vec3): Vec3 => {
  const L = len(a) || 1
  return [a[0]/L, a[1]/L, a[2]/L]
}
function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  // Rodrigues' rotation formula
  const k = norm(axis)
  const cos = Math.cos(angle), sin = Math.sin(angle)
  const term1 = mul(v, cos)
  const term2 = mul(cross(k, v), sin)
  const term3 = mul(k, dot(k, v) * (1 - cos))
  return add(add(term1, term2), term3)
}

function orbitCamera(vp: Types.IVolumeViewport, dx: number, dy: number) {
  // pixels -> radians
  const YAW_SPEED = 0.005
  const PITCH_SPEED = 0.005

  const cam = vp.getCamera()
  const P = cam.position as Vec3
  const F = cam.focalPoint as Vec3
  const U = norm(cam.viewUp as Vec3)

  // View direction (from camera toward focal point)
  const V = norm(sub(F, P))
  // Right vector = V x Up
  const R = norm(cross(V, U))

  // Apply yaw (horizontal drag) around Up, then pitch (vertical drag) around Right
  const yaw = -dx * YAW_SPEED
  const pitch = dy * PITCH_SPEED

  let V1 = rotateAroundAxis(V, U, yaw)
  let U1 = rotateAroundAxis(U, U, yaw) // same as U, keeps orthogonality
  const R1 = norm(cross(V1, U1))
  const V2 = rotateAroundAxis(V1, R1, pitch)
  let U2 = rotateAroundAxis(U1, R1, pitch)

  // Re-orthogonalize
  const R2 = norm(cross(V2, U2))
  U2 = norm(cross(R2, V2))

  const dist = len(sub(F, P))
  const newPos = sub(F, mul(V2, dist)) as Vec3

  vp.setCamera({ position: newPos, focalPoint: F, viewUp: U2 })
  vp.render()
}

function zoomCamera(vp: Types.IVolumeViewport, deltaY: number) {
  // wheel down -> zoom in; wheel up -> zoom out
  const ZOOM_FACTOR_PER_DELTA = 0.0015
  const cam = vp.getCamera()
  const P = cam.position as Vec3
  const F = cam.focalPoint as Vec3
  const V = norm(sub(F, P))
  const d = len(sub(F, P))

  const scale = Math.exp(deltaY * ZOOM_FACTOR_PER_DELTA)
  const newDist = Math.max(0.01, d * scale) // avoid crossing focal point
  const newPos = sub(F, mul(V, newDist)) as Vec3

  vp.setCamera({ position: newPos, focalPoint: F, viewUp: cam.viewUp as Vec3 })
  vp.render()
}

/* ---------------- Component ---------------- */
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

  // Build & render 3D volume
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
        volumeIdRef.current = VOLUME_ID

        const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, { imageIds: goodIds })
        await volume.load()

        const vvp = engine.getViewport(VIEWPORT_ID) as Types.IVolumeViewport
        vpRef.current = vvp

        await vvp.setVolumes([{ volumeId: VOLUME_ID }])
        vvp.resetCamera()

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
      const eng = engineRef.current
      if (eng) {
        try { eng.disableElement(VIEWPORT_ID) } catch {}
      }
      vpRef.current = null
      volumeIdRef.current = null
    }
  }, [imageIds])

  // Re-apply TF/blend when user changes settings
  useEffect(() => {
    const vp = vpRef.current
    const volId = volumeIdRef.current
    if (!vp || !volId) return
    try {
      applyAppearance(vp, volId, preset, blend)
    } catch {}
  }, [preset, blend])

  // Pointer interactions: left-drag orbit, wheel zoom
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    let dragging = false
    let lastX = 0, lastY = 0
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return // left button only
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture?.(e.pointerId)
      e.preventDefault()
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      const vp = vpRef.current
      if (!vp) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      orbitCamera(vp, dx, dy)
      e.preventDefault()
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return
      dragging = false
      el.releasePointerCapture?.(e.pointerId)
      e.preventDefault()
    }
    const onPointerLeave = () => { dragging = false }
    const onWheel = (e: WheelEvent) => {
      const vp = vpRef.current
      if (!vp) return
      zoomCamera(vp, e.deltaY)
      e.preventDefault()
    }

    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointerleave', onPointerLeave)
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointerleave', onPointerLeave)
      el.removeEventListener('wheel', onWheel as any)
    }
  }, [])

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
            disabled={blend === 'MIP (Max Intensity)'} // Preset color is irrelevant for MIP
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
        {error ? <span style={{ color: '#f66' }}>Error: {error}</span> : ready ? null : 'Loading…'}
      </div>
    </div>
  )
}
