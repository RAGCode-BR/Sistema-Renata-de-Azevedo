// Envia a fila do WhatsApp. Chamada pelo pg_cron (cabeçalho x-sync-secret) ou por quem atende as
// conversas, logo depois de escrever uma resposta.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendQueued, whatsappConfig } from '../_shared/whatsapp.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const secret = Deno.env.get('WHATSAPP_SEND_SECRET');
  if (!(secret && request.headers.get('x-sync-secret') === secret)) {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const asCaller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const { data: access } = token ? await asCaller.rpc('my_access') : { data: null };
    if (!access?.permissions?.includes('messages.manage')) return reply(401, { error: 'Entre na sua conta para continuar.' });
  }
  const config = whatsappConfig();
  if (!config.canSend) return reply(503, { error: 'O WhatsApp ainda não foi configurado pela administração.', code: 'not_configured' });
  return reply(200, await sendQueued(admin, config));
});
