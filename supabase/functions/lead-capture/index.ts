// Formulário de contato do site (renatadeazevedo.com.br): única entrada pública, sem login.
// Proteções: só aceita as origens permitidas (LEAD_ALLOWED_ORIGINS), campo-isca contra robôs, tempo
// mínimo de preenchimento, corpo pequeno, validação aqui e no banco, e limite de envios por IP
// (o IP é guardado só como hash). Grava pelo banco (capture_lead), que só a chave de serviço chama.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_ORIGINS = 'https://renatadeazevedo.com.br,https://www.renatadeazevedo.com.br';
const allowed = (Deno.env.get('LEAD_ALLOWED_ORIGINS') ?? DEFAULT_ORIGINS).split(',').map((item) => item.trim()).filter(Boolean);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function headers(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin && allowed.includes(origin) ? origin : allowed[0] ?? '',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
    'Content-Type': 'application/json; charset=utf-8'
  };
}

const field = (input: Record<string, unknown>, name: string, max: number) =>
  typeof input[name] === 'string' ? (input[name] as string).trim().slice(0, max) : '';

async function hash(value: string): Promise<string> {
  const salt = Deno.env.get('LEAD_IP_SALT') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${value}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: headers(origin) });
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(origin) });
  if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  // Navegadores sempre mandam Origin; de outro site, recusa.
  if (origin && !allowed.includes(origin)) return reply(403, { error: 'Origem não permitida.' });

  const raw = await request.text();
  if (raw.length > 10_000) return reply(413, { error: 'Envio grande demais.' });
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw);
  } catch {
    return reply(400, { error: 'Envio inválido.' });
  }

  // Robôs: preenchem o campo escondido ou enviam rápido demais. Responde como sucesso e descarta.
  const elapsed = Number(input.elapsed_ms ?? 0);
  if (field(input, 'website', 200) || (Number.isFinite(elapsed) && elapsed > 0 && elapsed < 2000)) return reply(200, { ok: true });

  const data = {
    name: field(input, 'name', 200), phone: field(input, 'phone', 40), email: field(input, 'email', 200).toLowerCase(),
    message: field(input, 'message', 2000), interest: field(input, 'interest', 120), location: field(input, 'location', 120),
    consent: input.consent === true,
    utm_source: field(input, 'utm_source', 100), utm_medium: field(input, 'utm_medium', 100), utm_campaign: field(input, 'utm_campaign', 100),
    utm_content: field(input, 'utm_content', 200), page: field(input, 'page', 500)
  };
  if (!data.name || (!data.phone && !data.email)) return reply(400, { error: 'Informe seu nome e um telefone ou e-mail.' });
  if (data.email && !EMAIL.test(data.email)) return reply(400, { error: 'E-mail inválido.' });
  if (data.phone && data.phone.replace(/\D/g, '').length < 10) return reply(400, { error: 'Telefone inválido: inclua o DDD.' });
  if (!data.consent) return reply(400, { error: 'Para continuar, autorize o contato.' });

  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'desconhecido';
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { error } = await admin.rpc('capture_lead', { p_data: data, p_ip_hash: await hash(ip) });
  if (error) {
    if (error.code === 'P0001') return reply(error.message.startsWith('Muitos') ? 429 : 400, { error: error.message });
    console.error(error);
    return reply(500, { error: 'Não foi possível enviar agora. Tente pelo WhatsApp.' });
  }
  return reply(200, { ok: true });
});
