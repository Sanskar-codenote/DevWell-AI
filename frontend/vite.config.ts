import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.VITE_PORT || env.FRONTEND_PORT || 5173)
  const proxyHost = env.VITE_API_PROXY_HOST || 'localhost'
  const proxyPort = env.VITE_API_PROXY_PORT || env.BACKEND_PORT || '3001'
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || `http://${proxyHost}:${proxyPort}`

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      port,
      proxy: {
        '/api': apiProxyTarget,
      },
    },
  }
})
