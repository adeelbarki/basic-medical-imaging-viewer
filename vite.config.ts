import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteCommonjs } from '@originjs/vite-plugin-commonjs'

export default defineConfig({
  plugins: [
    react(),
    viteCommonjs(),
  ],
  optimizeDeps: {
    exclude: [
      '@cornerstonejs/dicom-image-loader', 
      '@cornerstonejs/streaming-image-volume-loader'
    ],
    include: ['dicom-parser'],
  },
  worker: {
    format: 'es',
  },
})
