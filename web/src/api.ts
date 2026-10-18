import { createApi } from '../../shared/api.ts';
import { supabase } from './supabase.ts';

export const api = createApi(supabase);

// Chamado quando a sessão termina sem a pessoa ter clicado em Sair (ex.: expirou em outra aba).
export const setUnauthorizedHandler = (handler: () => void) => api.setUnauthorizedHandler(handler);
