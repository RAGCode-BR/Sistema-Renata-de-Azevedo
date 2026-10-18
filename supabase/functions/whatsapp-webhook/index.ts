// Webhook do WhatsApp (Meta). GET: verificação do cadastro (hub.verify_token). POST: confere a assinatura
// (X-Hub-Signature-256 com o App Secret) e registra situações de entrega e mensagens recebidas; botões
// de confirmação e respostas automáticas são tratados no banco (whatsapp_inbound).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendQueued, whatsappConfig } from '../_shared/whatsapp.ts';

const text = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

async function validSignature(secret: string, raw: string, header: string | null) {
  if (!header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7);
  if (given.length !== digest.length) return false;
  let diff = 0;
  for (let i = 0; i < digest.length; i++) diff |= digest.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

interface Incoming {
  from: string; id: string; type: string; text?: { body: string }; button?: { payload?: string; text?: string };
  interactive?: { button_reply?: { id: string; title: string } }; context?: { id: string };
}

Deno.serve(async (request) => {
  const config = whatsappConfig();
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (config.verifyToken && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === config.verifyToken) {
      return text(200, url.searchParams.get('hub.challenge') ?? '');
    }
    return text(403, 'Verificação recusada.');
  }
  if (request.method !== 'POST') return text(405, 'Método não permitido.');
  if (!config.appSecret) return text(503, 'WhatsApp não configurado.');
  const raw = await request.text();
  if (!(await validSignature(config.appSecret, raw, request.headers.get('x-hub-signature-256')))) return text(401, 'Assinatura inválida.');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let payload: { entry?: { changes?: { value?: Record<string, unknown> }[] }[] };
  try { payload = JSON.parse(raw); } catch { return text(400, 'JSON inválido.'); }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const names = new Map(((value.contacts ?? []) as { wa_id: string; profile?: { name?: string } }[]).map((c) => [c.wa_id, c.profile?.name ?? '']));
      for (const status of (value.statuses ?? []) as { id: string; status: string; errors?: { title?: string; message?: string }[] }[]) {
        await admin.rpc('whatsapp_status', { p_wamid: status.id, p_status: status.status, p_error: status.errors?.[0]?.message ?? status.errors?.[0]?.title ?? null });
      }
      for (const message of (value.messages ?? []) as Incoming[]) {
        const button = message.button?.payload ?? message.interactive?.button_reply?.id ?? null;
        const body = message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title ?? (message.type !== 'text' ? `[${message.type}]` : '');
        const { error } = await admin.rpc('whatsapp_inbound', {
          p_phone: message.from, p_name: names.get(message.from) ?? '', p_wamid: message.id, p_text: body,
          p_button: button, p_context_wamid: message.context?.id ?? null
        });
        if (error) console.error(error);
      }
    }
  }
  // Respostas automáticas (ex.: "sessão confirmada") saem na hora.
  if (config.canSend) await sendQueued(admin, config).catch((error) => console.error(error));
  return text(200, 'ok');
});
