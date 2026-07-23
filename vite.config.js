import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // 使用相对路径，Electron 打包后才能正确加载资源
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
