import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env (veja .env.example).');

// Chave pública: o que cada pessoa pode ver ou alterar é decidido pelas políticas RLS do banco
// (supabase/migrations), a partir da sessão de quem está conectado.
export const supabase = createClient(url, key);
