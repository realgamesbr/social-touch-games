import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,   // expõe em 0.0.0.0 — acessível na rede local
    port: 5174,
    https: {},    // HTTPS com certificado auto-assinado
  },
})
