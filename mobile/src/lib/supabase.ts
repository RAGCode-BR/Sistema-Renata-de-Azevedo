import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import { createApi } from '../../../shared/api.ts';
import { secureStorage } from './storage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('Defina EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY em mobile/.env (veja .env.example).');

// Chave pública: o que cada pessoa pode ver ou alterar é decidido pelas políticas do banco (RLS).
export const supabase = createClient(url, key, {
  auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web' }
});
export const api = createApi(supabase);

// Renova o token só com o app em primeiro plano.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh(); else supabase.auth.stopAutoRefresh();
  });
}
