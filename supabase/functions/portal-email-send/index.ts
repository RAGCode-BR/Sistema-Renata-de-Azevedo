// Envia os e-mails do portal (convite e "há uma novidade"). Chamada pelo pg_cron (x-sync-secret).
// O texto é sempre genérico: sem nome de profissional, horário, valor ou título de documento.
// Segredos: PORTAL_EMAIL_SECRET (interno), RESEND_API_KEY e PORTAL_EMAIL_FROM (remetente verificado no
// Resend, ex.: "Clínica Renata de Azevedo <portal@renatadeazevedo.com.br>"). RESEND_API_URL só muda em testes.
import { createClient } from 'npm:@supabase/supabase-js@2';

const API = Deno.env.get('RESEND_API_URL') ?? 'https://api.resend.com';
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

interface Queued { id: number; user_id: string; kind: 'invite' | 'notice'; attempts: number }

function message(kind: Queued['kind'], name: string, url: string) {
  const hello = `Olá${name ? `, ${name.split(' ')[0]}` : ''}!`;
  const lines = kind === 'invite'
    ? [hello, 'A clínica Renata de Azevedo liberou seu acesso ao portal do paciente, onde você acompanha suas sessões, pagamentos e documentos.',
      `Para entrar, acesse ${url} e informe este e-mail. Você vai receber um código de acesso.`]
    : [hello, 'Há uma novidade para você no portal do paciente da clínica Renata de Azevedo.', `Para ver, acesse ${url}.`];
  const footer = 'Se você não reconhece este e-mail, pode ignorá-lo. Não responda a esta mensagem.';
  return {
    subject: kind === 'invite' ? 'Seu acesso ao portal do paciente' : 'Novidade no portal do paciente',
    text: [...lines, '', footer].join('\n\n'),
    html: [...lines.map((line) => `<p>${line.replace(url, `<a href="${url}">${url}</a>`)}</p>`), `<p style="color:#777;font-size:12px">${footer}</p>`].join('')
  };
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  const secret = Deno.env.get('PORTAL_EMAIL_SECRET');
  if (!secret || request.headers.get('x-sync-secret') !== secret) return reply(401, { error: 'Não autorizado.' });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const state = (lastError: string | null) =>
    admin.from('integration_state').update({ last_run_at: new Date().toISOString(), last_error: lastError }).eq('key', 'portal_email');

  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('PORTAL_EMAIL_FROM');
  const { data: settings } = await admin.from('clinic_settings').select('portal_url').maybeSingle();
  if (!key || !from || !settings?.portal_url) {
    await state('Envio de e-mail não configurado (RESEND_API_KEY, PORTAL_EMAIL_FROM e endereço do portal).');
    return reply(200, { sent: 0, failed: 0 });
  }

  const { data } = await admin.from('portal_email_outbox').select('id, user_id, kind, attempts').eq('status', 'queued').lt('attempts', 5).order('id').limit(50);
  const queue = (data ?? []) as Queued[];
  let sent = 0, failed = 0;
  for (const item of queue) {
    const { data: person } = await admin.from('profiles').select('name, email, active').eq('id', item.user_id).maybeSingle();
    if (!person?.active || !person.email) {
      await admin.from('portal_email_outbox').update({ status: 'failed', error: 'Conta inativa ou sem e-mail.' }).eq('id', item.id);
      continue;
    }
    const content = message(item.kind, person.name ?? '', settings.portal_url);
    const response = await fetch(`${API}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [person.email], ...content })
    }).catch((error) => new Response(JSON.stringify({ message: String(error) }), { status: 599 }));
    if (response.ok) {
      await admin.from('portal_email_outbox').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', item.id);
      sent++;
    } else {
      const detail = await response.json().catch(() => ({}));
      const attempts = item.attempts + 1;
      await admin.from('portal_email_outbox').update({
        attempts, status: attempts >= 5 ? 'failed' : 'queued', error: String(detail?.message ?? `HTTP ${response.status}`).slice(0, 300)
      }).eq('id', item.id);
      failed++;
    }
  }
  await state(failed ? 'Alguns e-mails não foram enviados.' : null);
  return reply(200, { sent, failed });
});
