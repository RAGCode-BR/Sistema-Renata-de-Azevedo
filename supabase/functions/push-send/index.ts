// Envia a fila de push do aplicativo (serviço de push da Expo). Chamada pelo pg_cron (x-sync-secret).
// Segredos: PUSH_SEND_SECRET (interno); EXPO_ACCESS_TOKEN só se o projeto na Expo exigir envio autenticado.
// PUSH_API_URL só muda em testes.
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = Deno.env.get('PUSH_API_URL') ?? 'https://exp.host/--/api/v2/push/send';
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

interface Queued { id: number; token: string; title: string; body: string; link: string | null; attempts: number }
interface Ticket { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  const secret = Deno.env.get('PUSH_SEND_SECRET');
  if (!secret || request.headers.get('x-sync-secret') !== secret) return reply(401, { error: 'Não autorizado.' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data } = await admin.from('push_outbox').select('id, token, title, body, link, attempts').eq('status', 'queued').lt('attempts', 5).order('id').limit(100);
  const queue = (data ?? []) as Queued[];
  if (!queue.length) return reply(200, { sent: 0, failed: 0 });

  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  const response = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(queue.map((item) => ({ to: item.token, title: item.title, body: item.body, sound: 'default', data: { link: item.link } })))
  }).catch((error) => new Response(JSON.stringify({ errors: [{ message: String(error) }] }), { status: 599 }));
  const result = await response.json().catch(() => ({}));
  const tickets: Ticket[] = Array.isArray(result?.data) ? result.data : [];

  let sent = 0, failed = 0;
  for (const [index, item] of queue.entries()) {
    const ticket = tickets[index];
    if (ticket?.status === 'ok') {
      await admin.from('push_outbox').update({ status: 'sent', ticket_id: ticket.id ?? null, sent_at: new Date().toISOString(), error: null }).eq('id', item.id);
      sent++;
      continue;
    }
    failed++;
    const reason = ticket?.details?.error ?? ticket?.message ?? result?.errors?.[0]?.message ?? `HTTP ${response.status}`;
    // Aparelho desinstalado ou token inválido: não adianta tentar de novo.
    if (ticket?.details?.error === 'DeviceNotRegistered') {
      await admin.from('push_devices').delete().eq('token', item.token);
      await admin.from('push_outbox').update({ status: 'failed', error: reason }).eq('id', item.id);
    } else {
      const attempts = item.attempts + 1;
      await admin.from('push_outbox').update({ attempts, error: String(reason).slice(0, 300), status: attempts >= 5 ? 'failed' : 'queued' }).eq('id', item.id);
    }
  }
  await admin.from('integration_state').update({ last_run_at: new Date().toISOString(), last_error: failed ? 'Alguns avisos não foram entregues.' : null }).eq('key', 'push');
  return reply(200, { sent, failed });
});
