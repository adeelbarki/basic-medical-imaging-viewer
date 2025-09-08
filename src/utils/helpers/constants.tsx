import {
  Enums,
  type Types,
} from '@cornerstonejs/core'

// Simple, opinionated CT presets (HU domain). Tune as you like.
type TFNode = { x: number; r: number; g: number; b: number; a: number }

// Colors are 0..1, a = opacity 0..1, x = HU
const TF_PRESETS: Record<string, TFNode[]> = {
  'CT Soft Tissue': [
    { x: -1000, r: 0.00, g: 0.00, b: 0.00, a: 0.00 },
    { x: -200,  r: 0.10, g: 0.10, b: 0.40, a: 0.05 },
    { x:   40,  r: 0.95, g: 0.70, b: 0.40, a: 0.15 },
    { x:  300,  r: 1.00, g: 0.95, b: 0.85, a: 0.60 },
    { x: 2000,  r: 1.00, g: 0.98, b: 0.95, a: 0.90 },
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
}

// function applyTransferFunction(vp: Types.IVolumeViewport, volumeId: string, presetName: keyof typeof TF_PRESETS) {
//   const nodes = TF_PRESETS[presetName]
//   // Cornerstone3D exposes setTransferFunctionNodes on VolumeViewport
//   vp.setTransferFunctionNodes([{ volumeId, nodes }])
//   // Keep COMPOSITE for “full color” VR (vs MIP)
//   vp.setBlendMode(Enums.BlendModes.COMPOSITE)
//   vp.render()
// }
