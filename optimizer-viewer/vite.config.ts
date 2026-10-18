import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  base: './', root,
  publicDir: path.resolve(root, '../runs/optimizer-viewer/data'),
  server: { host: '127.0.0.1', port: 5192, strictPort: true, fs: { allow: [path.resolve(root, '..')] } },
  preview: { host: '127.0.0.1', port: 5192, strictPort: true },
  build: { outDir: path.resolve(root, '../runs/optimizer-viewer-dist'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500 },
});
