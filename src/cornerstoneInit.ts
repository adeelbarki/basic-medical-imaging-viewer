// cornerstoneInit.ts
// import { init as coreInit } from '@cornerstonejs/core';
// // Side-effect imports register loaders & workers
// import '@cornerstonejs/streaming-image-volume-loader';
// import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

// let done = false;
// export async function initCornerstone() {
//   if (done) return;
//   await coreInit();              // Core first
//   await dicomImageLoaderInit();  // Then DICOM WADO-URI loader
//   done = true;
// }

// cornerstoneInit.ts
import { init as coreInit, setUseCPURendering } from '@cornerstonejs/core';
import '@cornerstonejs/streaming-image-volume-loader';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';

declare global {
  var __CS_INIT_DONE__: boolean | undefined;
}

export async function initCornerstone() {
  if (globalThis.__CS_INIT_DONE__) return;

  await coreInit();
  await dicomImageLoaderInit();
  setUseCPURendering(false)
  globalThis.__CS_INIT_DONE__ = true;
}


