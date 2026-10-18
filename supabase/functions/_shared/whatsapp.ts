// WhatsApp Business Platform (Cloud API da Meta): configuração e envio da fila whatsapp_messages.
// Segredos: WHATSAPP_TOKEN (token permanente de usuário do sistema), WHATSAPP_PHONE_NUMBER_ID (ID do
// número na Meta), WHATSAPP_APP_SECRET (assinatura do webhook), WHATSAPP_VERIFY_TOKEN (cadastro do
// webhook), WHATSAPP_SEND_SECRET (chamada do pg_cron). WHATSAPP_API_URL só muda em testes.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function whatsappConfig() {
  const token = Deno.env.get('WHATSAPP_TOKEN') ?? '';
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
  return {
    canSend: Boolean(token && phoneNumberId),
    token, phoneNumberId,
    appSecret: Deno.env.get('WHATSAPP_APP_SECRET') ?? '',
    verifyToken: Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '',
    language: Deno.env.get('WHATSAPP_TEMPLATE_LANGUAGE') ?? 'pt_BR',
    apiUrl: (Deno.env.get('WHATSAPP_API_URL') ?? 'https://graph.facebook.com/v21.0').replace(/\/$/, '')
  };
}
export type WhatsappConfig = ReturnType<typeof whatsappConfig>;

interface Queued { id: string; phone: string; kind: string; template: string | null; params: string[]; body: string; attempts: number }

// Modelo aprovado (com variáveis) ou texto livre (respostas dentro da janela de 24 h).
export function messagePayload(config: WhatsappConfig, item: Queued) {
  if (!item.template) return { messaging_product: 'whatsapp', to: item.phone, type: 'text', text: { body: item.body, preview_url: true } };
  const components: unknown[] = [{ type: 'body', parameters: item.params.map((text) => ({ type: 'text', text })) }];
  if (item.template === 'confirmacao_sessao') {
    components.push(
      { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'CONFIRMAR' }] },
      { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'REMARCAR' }] }
    );
  }
  return { messaging_product: 'whatsapp', to: item.phone, type: 'template', template: { name: item.template, language: { code: config.language }, components } };
}

export async function sendQueued(admin: SupabaseClient, config: WhatsappConfig) {
  let sent = 0, failed = 0;
  let lastError: string | null = null;
  const { data: queue } = await admin.from('whatsapp_messages').select('id, phone, kind, template, params, body, attempts')
    .eq('status', 'queued').lt('attempts', 5).order('created_at').limit(50);
  for (const item of (queue ?? []) as Queued[]) {
    const response = await fetch(`${config.apiUrl}/${config.phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(messagePayload(config, item))
    }).catch((error) => new Response(JSON.stringify({ error: { message: String(error) } }), { status: 599 }));
    const data = await response.json().catch(() => ({}));
    const wamid = data?.messages?.[0]?.id;
    if (response.ok && wamid) {
      await admin.from('whatsapp_messages').update({ status: 'sent', wamid, sent_at: new Date().toISOString(), error: null }).eq('id', item.id);
      sent++;
    } else {
      failed++;
      lastError = `${response.status} ${data?.error?.message ?? 'erro desconhecido'}`.slice(0, 500);
      const attempts = item.attempts + 1;
      await admin.from('whatsapp_messages').update({ attempts, error: lastError, status: attempts >= 5 ? 'failed' : 'queued' }).eq('id', item.id);
    }
  }
  await admin.from('integration_state').update({ last_run_at: new Date().toISOString(), last_error: lastError, updated_at: new Date().toISOString() }).eq('key', 'whatsapp');
  return { sent, failed };
}
