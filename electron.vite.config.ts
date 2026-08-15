import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    server: {
      // 5173 落在 Windows 保留端口范围内(netsh excludedportrange),改用未保留端口
      port: 15173,
      strictPort: true
    }
  }
})
