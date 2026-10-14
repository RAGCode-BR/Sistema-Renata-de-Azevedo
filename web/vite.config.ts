import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = `http://127.0.0.1:${process.env.PORT || 8787}`;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Em desenvolvimento, o Vite repassa a API ao servidor Node (npm start).
      // O servidor só aceita alterações vindas da própria origem, então a origem é ajustada aqui.
      '/api': {
        target: server,
        configure: (proxy) => proxy.on('proxyReq', (request) => request.setHeader('origin', server))
      }
    }
  }
});
