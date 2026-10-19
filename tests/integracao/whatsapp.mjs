// Teste de integração do WhatsApp: funções reais (Deno, local) + banco real + Meta simulada.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';

const PROJECT = process.env.PROJECT_DIR;
const SCRATCH = process.env.WORK_DIR;
const { createClient } = createRequire(`${PROJECT}/package.json`)('@supabase/supabase-js');
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const fail = (m) => { throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const must = async (q, label) => { const r = await q; if (r.error) throw new Error(label + ': ' + r.error.message); return r; };
const sql = (query) => execSync(`npx supabase db query --linked ${JSON.stringify(query)}`, { cwd: PROJECT, stdio: ['ignore', 'pipe', 'inherit'] }).toString();

// Meta simulada: recebe os envios e devolve o id da mensagem.
const sent = [];
const meta = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  if (req.headers.authorization !== 'Bearer token-meta-teste') { res.writeHead(401); return res.end('{"error":{"message":"token"}}'); }
  const data = JSON.parse(body);
  sent.push({ path: req.url, data });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ messages: [{ id: `wamid.TESTE${sent.length}` }] }));
});
await new Promise((r) => meta.listen(9922, r));

const APP_SECRET = 'segredo-app-teste';
const env = {
  ...process.env, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY: ANON,
  WHATSAPP_TOKEN: 'token-meta-teste', WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_VERIFY_TOKEN: 'verifica-teste',
  WHATSAPP_SEND_SECRET: 'envio-teste', WHATSAPP_API_URL: 'http://127.0.0.1:9922', NO_COLOR: '1'
};
const ports = { 'whatsapp-send': 8811, 'whatsapp-webhook': 8812 };
const children = [];
for (const [name, port] of Object.entries(ports)) {
  children.push(spawn(process.env.DENO_BIN, ['run', '--allow-net', '--allow-env', '--allow-read', `${PROJECT}/supabase/functions/${name}/index.ts`],
    { cwd: SCRATCH, env: { ...env, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}` }, stdio: 'ignore' }));
}
const fn = (name) => `http://127.0.0.1:${ports[name]}`;
for (const name of Object.keys(ports)) { for (let i = 0; i < 60; i++) { try { await fetch(fn(name), { method: 'OPTIONS' }); break; } catch { await sleep(500); } } }

const ids = { professional: crypto.randomUUID(), patient: crypto.randomUUID(), confirm: crypto.randomUUID(), remind: crypto.randomUUID() };
const PATIENT_PHONE = '5521988881234';
const UNKNOWN = '5521944443333';
const signed = (payload) => {
  const raw = JSON.stringify(payload);
  return { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex') }, body: raw };
};
const webhook = (messages = [], statuses = [], contacts = []) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', contacts, messages, statuses } }] }] });

async function cleanup() {
  await admin.from('whatsapp_messages').delete().in('phone', [PATIENT_PHONE, UNKNOWN]);
  await admin.from('notifications').delete().eq('kind', 'message_new');
  await admin.from('leads').delete().eq('phone_key', UNKNOWN.slice(2));
  await admin.from('appointments').delete().eq('patient_id', ids.patient);
  await admin.from('patient_professionals').delete().eq('patient_id', ids.patient);
  await admin.from('patients').delete().eq('id', ids.patient);
  await admin.from('professionals').delete().eq('id', ids.professional);
  await admin.from('integration_state').update({ enabled: false, config: {}, last_run_at: null, last_error: null }).eq('key', 'whatsapp');
}

try {
  await must(admin.from('professionals').insert({ id: ids.professional, name: 'Teste WhatsApp Prof' }), 'profissional');
  await must(admin.from('patients').insert({ id: ids.patient, name: 'Paciente WhatsApp Exemplo', phone: '(21) 98888-1234', whatsapp_opt_in: true, whatsapp_opt_in_at: new Date().toISOString() }), 'paciente');
  await must(admin.from('patient_professionals').insert({ patient_id: ids.patient, professional_id: ids.professional }), 'vínculo');
  const inHours = (h) => new Date(Date.now() + h * 3600_000);
  await must(admin.from('appointments').insert([
    { id: ids.confirm, patient_id: ids.patient, professional_id: ids.professional, starts_at: inHours(26).toISOString(), ends_at: inHours(26.83).toISOString(), status: 'scheduled', modality: 'presencial', meeting_url: null },
    { id: ids.remind, patient_id: ids.patient, professional_id: ids.professional, starts_at: inHours(1.5).toISOString(), ends_at: inHours(2.33).toISOString(), status: 'confirmed', modality: 'online', meeting_url: 'https://meet.google.com/xyz-teste' }
  ]), 'sessões');
  await must(admin.from('integration_state').update({ enabled: true, config: { app_url: 'https://sistema.example.test' } }).eq('key', 'whatsapp'), 'integração');

  // 1. Agendamento + envio (como o pg_cron faria).
  console.log('enfileiradas:', sql('SELECT private.whatsapp_enqueue_due() AS n').match(/"n": (\d+)/)?.[1]);
  const denied = await fetch(fn('whatsapp-send'), { method: 'POST', headers: { 'x-sync-secret': 'errado' } });
  if (denied.status !== 401) fail('Envio sem autorização: ' + denied.status);
  const result = await (await fetch(fn('whatsapp-send'), { method: 'POST', headers: { 'x-sync-secret': 'envio-teste' } })).json();
  const confirmation = sent.find((s) => s.data.template?.name === 'confirmacao_sessao' && s.data.to === PATIENT_PHONE);
  const reminder = sent.find((s) => s.data.template?.name === 'lembrete_sessao' && s.data.to === PATIENT_PHONE);
  if (result.sent < 2 || !confirmation || !reminder) fail('Envio: ' + JSON.stringify(result) + JSON.stringify(sent.map((s) => s.data.template?.name)));
  const params = (m) => m.data.template.components[0].parameters.map((p) => p.text);
  const buttons = confirmation.data.template.components.filter((c) => c.type === 'button').map((c) => c.parameters[0].payload).join(',');
  if (confirmation.path !== '/123456/messages' || confirmation.data.template.language.code !== 'pt_BR' || buttons !== 'CONFIRMAR,REMARCAR'
    || params(confirmation)[0] !== 'Paciente' || params(confirmation)[1] !== 'Teste WhatsApp Prof' || !params(reminder)[3].includes('https://meet.google.com/xyz-teste')) {
    fail('Conteúdo dos modelos: ' + JSON.stringify([confirmation.data, reminder.data]));
  }
  const { data: conf } = await admin.from('whatsapp_messages').select('wamid, status').eq('appointment_id', ids.confirm).eq('kind', 'confirmation').single();
  const { data: appt } = await admin.from('appointments').select('status').eq('id', ids.confirm).single();
  if (conf.status !== 'sent' || !conf.wamid || appt.status !== 'awaiting_confirmation') fail('Situação após envio: ' + JSON.stringify([conf, appt]));
  ok('Confirmação (com botões Confirmar/Preciso remarcar) e lembrete com link do Meet enviados como modelos pt_BR; sessão "aguardando confirmação"');

  // 2. Webhook: verificação e assinatura.
  const verify = await fetch(`${fn('whatsapp-webhook')}/?hub.mode=subscribe&hub.verify_token=verifica-teste&hub.challenge=42`);
  const wrongVerify = await fetch(`${fn('whatsapp-webhook')}/?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=42`);
  const unsigned = await fetch(fn('whatsapp-webhook'), { method: 'POST', body: JSON.stringify(webhook()) });
  const badSig = await fetch(fn('whatsapp-webhook'), { ...signed(webhook()), headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) } });
  if ((await verify.text()) !== '42' || wrongVerify.status !== 403 || unsigned.status !== 401 || badSig.status !== 401) fail('Verificação/assinatura do webhook');
  ok('Webhook: cadastro verificado com o token certo; chamadas sem assinatura válida recusadas');

  // 3. Entregue/lida e botão "Confirmar".
  await fetch(fn('whatsapp-webhook'), signed(webhook([], [{ id: conf.wamid, status: 'delivered' }, { id: conf.wamid, status: 'read' }])));
  const before = sent.length;
  await fetch(fn('whatsapp-webhook'), signed(webhook(
    [{ from: PATIENT_PHONE, id: 'wamid.IN-CONF', type: 'button', button: { payload: 'CONFIRMAR', text: 'Confirmar' }, context: { id: conf.wamid } }],
    [], [{ wa_id: PATIENT_PHONE, profile: { name: 'Paciente' } }])));
  const { data: after } = await admin.from('appointments').select('status').eq('id', ids.confirm).single();
  const { data: read } = await admin.from('whatsapp_messages').select('status').eq('wamid', conf.wamid).single();
  const answer = sent.slice(before).find((s) => s.data.type === 'text' && s.data.to === PATIENT_PHONE);
  if (after.status !== 'confirmed' || read.status !== 'read' || !answer?.data.text.body.includes('confirmada')) fail('Confirmar: ' + JSON.stringify([after, read, answer?.data]));
  ok('Paciente tocou "Confirmar": sessão confirmada na agenda, resposta automática enviada e mensagem marcada como lida');

  // 4. Número desconhecido vira lead.
  await fetch(fn('whatsapp-webhook'), signed(webhook([{ from: UNKNOWN, id: 'wamid.IN-LEAD', type: 'text', text: { body: 'Oi! Vocês atendem casal on-line?' } }], [],
    [{ wa_id: UNKNOWN, profile: { name: 'Contato WhatsApp Exemplo' } }])));
  const { data: lead } = await admin.from('leads').select('name, lead_sources(name)').eq('phone_key', UNKNOWN.slice(2)).single();
  if (lead.name !== 'Contato WhatsApp Exemplo' || lead.lead_sources.name !== 'WhatsApp direto') fail('Lead: ' + JSON.stringify(lead));
  ok('Mensagem de número desconhecido virou lead "WhatsApp direto" com o nome do perfil');

  if (process.env.PAUSE_FOR_UI) { console.log('PAUSA_UI'); await new Promise((r) => process.stdin.once('data', r)); }

  // 5. Resposta da equipe que ficou na fila (função publicada sem credenciais) sai pelo envio local.
  const queued = await admin.from('whatsapp_messages').select('id').eq('phone', UNKNOWN).eq('kind', 'free').eq('status', 'queued');
  if (queued.data?.length) {
    await fetch(fn('whatsapp-send'), { method: 'POST', headers: { 'x-sync-secret': 'envio-teste' } });
    if (!sent.some((s) => s.data.to === UNKNOWN && s.data.type === 'text')) fail('Resposta livre não enviada');
    ok('Resposta escrita na tela de Conversas foi enviada como texto livre (dentro da janela de 24 h)');
  }
} catch (error) {
  console.log('✘ Falhou:', error.message);
  process.exitCode = 1;
} finally {
  await cleanup().catch((e) => console.log('limpeza:', e.message));
  for (const child of children) child.kill();
  meta.close();
  const { count } = await admin.from('whatsapp_messages').select('id', { count: 'exact', head: true });
  console.log('mensagens restantes:', count);
}
