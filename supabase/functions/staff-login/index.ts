// Entrada da equipe por nome de usuário e senha. O e-mail fica privado no servidor.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { reply } from '../_shared/admin.ts';

const invalid = () => reply(401, { error: 'Login ou senha inválidos.' });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return reply(200, {});
  if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  let input: { username?: unknown; password?: unknown };
  try { input = await request.json(); } catch { return invalid(); }
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username) || !password) return invalid();

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } });
  const { data: profile, error: lookupError } = await admin.from('profiles')
    .select('id, email, active, user_roles(role)').eq('username', username).maybeSingle();
  if (lookupError) { console.error(lookupError); return reply(500, { error: 'Não foi possível entrar agora.' }); }
  if (!profile?.active || !profile.user_roles?.some((entry: { role: string }) => entry.role !== 'patient')) return invalid();

  // Auth aplica a validação da senha e seus limites de tentativas.
  const auth = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email: profile.email, password });
  if (error?.status === 429) return reply(429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
  if (error || !data.session || data.user?.id !== profile.id) return invalid();
  return reply(200, { access_token: data.session.access_token, refresh_token: data.session.refresh_token });
});
