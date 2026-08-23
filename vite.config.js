import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 前端源码在 web/，构建产物 web/dist 由后端同端口托管
export default defineConfig({
  root: 'web',
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
