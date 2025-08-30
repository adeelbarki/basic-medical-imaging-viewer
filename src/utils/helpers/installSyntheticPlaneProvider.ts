import {
  metaData,
  imageLoader
} from '@cornerstonejs/core'

declare global {
  // prevent duplicate provider across HMR/re-mounts
  // eslint-disable-next-line no-var
  var __CS_SYNTH_PLANE_INSTALLED__: boolean | undefined;
}

export async function installSyntheticPlaneProvider(imageIds: string[]) {
  if (globalThis.__CS_SYNTH_PLANE_INSTALLED__) return;

  // Prime metadata for first slice so we can read spacing/orientation if present
  try { await imageLoader.loadAndCacheImage(imageIds[0]); } catch {}

  // Read what we can from the first slice (no provider registered yet, so no recursion)
  const plane0 = metaData.get('imagePlaneModule', imageIds[0]) as
    | {
        pixelSpacing?: [number, number];
        imageOrientationPatient?: [number, number, number, number, number, number];
        spacingBetweenSlices?: number;
        sliceThickness?: number;
      }
    | undefined;

  // Prefer (0018,0088) Spacing Between Slices, else (0018,0050) Slice Thickness, else 1mm
  const zSpacing =
    (plane0?.spacingBetweenSlices ?? plane0?.sliceThickness ?? 1.0) as number;

  const pixelSpacing: [number, number] = (plane0?.pixelSpacing as any) ?? [1.0, 1.0];
  const ORIENTATION: [number, number, number, number, number, number] =
    (plane0?.imageOrientationPatient as any) ?? [1, 0, 0, 0, 1, 0];

  // Index map: imageId -> slice index
  const indexById = new Map(imageIds.map((id, i) => [id, i]));

  // ⚠️ IMPORTANT: DO NOT call metaData.get inside this provider.
  // Just return a synthetic plane using the precomputed values above.
  metaData.addProvider((type: string, imageId: string) => {
    if (type !== 'imagePlaneModule') return;

    const idx = indexById.get(imageId);
    if (idx == null) return;

    const z = idx * zSpacing;
    const [rx, ry, rz, cx, cy, cz] = ORIENTATION;

    return {
      imagePositionPatient: [0, 0, z],
      imageOrientationPatient: ORIENTATION,
      pixelSpacing,
      // convenience fields some consumers read:
      rowCosines: [rx, ry, rz],
      columnCosines: [cx, cy, cz],
      sliceThickness: plane0?.sliceThickness,
      spacingBetweenSlices: plane0?.spacingBetweenSlices,
    };
  }, /* priority */ 9999); // high priority so geometry is guaranteed present

  globalThis.__CS_SYNTH_PLANE_INSTALLED__ = true;
}