import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// O .env fica na raiz do projeto (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).
const envDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ command, mode }) => {
  // Sem as variáveis, a interface publicada abriria em branco. Na Cloudflare, elas ficam em
  // Configurações → Build → Variáveis e segredos de build.
  if (command === 'build') {
    const env = { ...loadEnv(mode, envDir, 'VITE_'), ...process.env };
    const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((name) => !env[name]);
    if (missing.length) throw new Error(`Variáveis ausentes no build: ${missing.join(', ')} (veja .env.example).`);
  }

  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    envDir,
    plugins: [react()],
    server: { port: 5173 }
  };
});
