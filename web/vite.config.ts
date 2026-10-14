import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // O .env fica na raiz do projeto (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()],
  server: { port: 5173 }
});
