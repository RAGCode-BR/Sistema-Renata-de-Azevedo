// Teste de integração do Google: funções reais (Deno, local) + banco real + Google simulado.
// Rodado por tests/run.mjs (variáveis de ambiente preenchidas por ele; a chave nunca é impressa).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { start, log, events } from './mock-google.mjs';

const PROJECT = process.env.PROJECT_DIR;
const { createClient } = createRequire(`${PROJECT}/package.json`)('@supabase/supabase-js');
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const DENO = process.env.DENO_BIN;
const MOCK = 'http://127.0.0.1:9911';
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const fail = (m) => { throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = {
  ...process.env, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY: ANON,
  GOOGLE_CLIENT_ID: 'cliente-teste', GOOGLE_CLIENT_SECRET: 'segredo-teste', GOOGLE_TOKEN_KEY: crypto.randomBytes(32).toString('base64'),
  GOOGLE_SYNC_SECRET: 'segredo-sync-teste', APP_URL: 'http://localhost:5173',
  GOOGLE_AUTH_URL: `${MOCK}/auth`, GOOGLE_OAUTH_URL: MOCK, GOOGLE_API_URL: MOCK, GOOGLE_USERINFO_URL: `${MOCK}/userinfo`, NO_COLOR: '1'
};
const ports = { 'google-oauth-start': 8801, 'google-oauth-callback': 8802, 'google-sync': 8803, 'google-disconnect': 8804 };
const children = [];
const fn = (name) => `http://127.0.0.1:${ports[name]}`;

const ids = { professional: crypto.randomUUID(), patient: crypto.randomUUID(), user: null, online: crypto.randomUUID(), office: crypto.randomUUID() };
const EMAIL = 'teste-google@example.test';
const PASSWORD = 'Senha-Google-ok-1';

async function cleanup() {
  const { data: accounts } = await admin.from('google_accounts').select('id').eq('google_subject', 'google-sub-e2e');
  for (const account of accounts ?? []) await admin.from('google_accounts').delete().eq('id', account.id);
  await admin.from('appointments').delete().eq('patient_id', ids.patient);
  await admin.from('patient_professionals').delete().eq('patient_id', ids.patient);
  await admin.from('patients').delete().eq('id', ids.patient);
  const { data: users } = await admin.auth.admin.listUsers();
  for (const user of users.users.filter((u) => u.email === EMAIL)) await admin.auth.admin.deleteUser(user.id);
  await admin.from('professionals').delete().eq('name', 'Teste Google Prof');
  await admin.from('audit_log').delete().eq('entity_type', 'google_account');
  await admin.from('integration_state').update({ enabled: false, last_run_at: null, last_error: null }).eq('key', 'google');
}

let mock;
try {
  mock = await start(9911);
  for (const [name, port] of Object.entries(ports)) {
    const child = spawn(DENO, ['run', '--allow-net', '--allow-env', '--allow-read', `${PROJECT}/supabase/functions/${name}/index.ts`],
      { cwd: process.env.WORK_DIR, env: { ...env, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}` }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(`[${name}] ${d}`));
    children.push(child);
  }
  for (const name of Object.keys(ports)) {
    for (let i = 0; i < 60; i++) { try { await fetch(fn(name), { method: 'OPTIONS' }); break; } catch { await sleep(500); } }
  }
  await cleanup();

  // Cenário: profissional com conta, paciente e duas sessões (amanhã on-line, depois de amanhã presencial).
  await admin.from('professionals').insert({ id: ids.professional, name: 'Teste Google Prof' });
  const { data: created, error: userError } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true,
    user_metadata: { name: 'Teste Google Prof' }, app_metadata: { roles: ['professional'], professional_id: ids.professional } });
  if (userError) fail(userError.message);
  ids.user = created.user.id;
  await admin.from('patients').insert({ id: ids.patient, name: 'Paciente Google Exemplo' });
  await admin.from('patient_professionals').insert({ patient_id: ids.patient, professional_id: ids.professional });
  const at = (offset, h) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, 0, 0, 0); return d; };
  await admin.from('appointments').insert([
    { id: ids.online, patient_id: ids.patient, professional_id: ids.professional, starts_at: at(1, 10).toISOString(), ends_at: new Date(at(1, 10).getTime() + 50 * 60000).toISOString(), modality: 'online' },
    { id: ids.office, patient_id: ids.patient, professional_id: ids.professional, starts_at: at(2, 14).toISOString(), ends_at: new Date(at(2, 14).getTime() + 50 * 60000).toISOString(), modality: 'presencial' }
  ]);
  const session = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signed } = await session.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const jwt = signed.session.access_token;

  // 1. Início da conexão.
  const startRes = await fetch(fn('google-oauth-start'), { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: '{}' });
  const startBody = await startRes.json();
  const { url } = startBody;
  if (!url) fail('Início: ' + startRes.status + ' ' + JSON.stringify(startBody));
  const auth = new URL(url);
  if (!url.startsWith(`${MOCK}/auth`) || auth.searchParams.get('access_type') !== 'offline' || !auth.searchParams.get('scope').includes('calendar.events')
    || auth.searchParams.get('redirect_uri') !== `${URL_}/functions/v1/google-oauth-callback`) fail('URL de autorização: ' + url);
  ok('Conexão iniciada: endereço de autorização com acesso contínuo, escopo de eventos e retorno para a função do Supabase');

  const { data: ownerSigned } = await session.auth.signInWithPassword({ email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD });
  const notPro = await fetch(fn('google-oauth-start'), { method: 'POST', headers: { Authorization: `Bearer ${ownerSigned.session.access_token}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (notPro.status !== 403) fail('Não profissional iniciou conexão: ' + notPro.status);
  const state = auth.searchParams.get('state');
  const tampered = await fetch(`${fn('google-oauth-callback')}/?code=codigo-bom&state=${encodeURIComponent(state.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))}`, { redirect: 'manual' });
  if (!tampered.headers.get('location')?.endsWith('google=invalido')) fail('Estado adulterado aceito: ' + tampered.headers.get('location'));
  ok('Recusas: quem não é profissional não conecta; retorno com estado adulterado é rejeitado');

  // 2. Retorno do Google.
  const back = await fetch(`${fn('google-oauth-callback')}/?code=codigo-bom&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
  if (back.headers.get('location') !== 'http://localhost:5173/#/google-agenda?google=conectado') fail('Retorno: ' + back.headers.get('location'));
  const { data: account } = await admin.from('google_accounts').select('id, google_email, refresh_token_ciphertext').eq('user_id', ids.user).single();
  if (Buffer.from(account.refresh_token_ciphertext.replace(/^\\x/, ''), 'hex').toString().includes('mock-refresh')) fail('Token gravado sem cifra');
  const { data: cals } = await admin.from('google_calendars').select('display_name, selected, push_target').eq('google_account_id', account.id).order('display_name');
  const personal = cals.find((c) => c.display_name === 'Agenda pessoal');
  if (cals.length !== 2 || !personal.push_target || !personal.selected || cals.find((c) => c.display_name === 'Feriados').selected) fail('Calendários: ' + JSON.stringify(cals));
  const { count: queued } = await admin.from('calendar_sync_queue').select('id', { count: 'exact', head: true }).is('done_at', null).in('appointment_id', [ids.online, ids.office]);
  if (queued !== 2) fail('Fila após conectar: ' + queued);
  ok('Conta conectada: token cifrado, 2 calendários importados, "Agenda pessoal" como destino e as 2 sessões na fila');

  // 3. Sincronização (pelo segredo do pg_cron).
  const denied = await fetch(fn('google-sync'), { method: 'POST', headers: { 'x-sync-secret': 'errado' } });
  if (denied.status !== 401) fail('Sincronização sem autorização: ' + denied.status);
  const sync = await (await fetch(fn('google-sync'), { method: 'POST', headers: { 'x-sync-secret': 'segredo-sync-teste' } })).json();
  if (sync.pushed !== 2 || sync.failed !== 0) fail('Sincronização: ' + JSON.stringify(sync));
  const created2 = [...events.values()].map((e) => e.body);
  const online = created2.find((e) => e.conferenceData);
  if (created2.length !== 2 || !online || created2.some((e) => e.summary !== 'Atendimento (P. G. E.)') || created2.some((e) => e.description.includes('Paciente'))) fail('Eventos: ' + JSON.stringify(created2));
  const { data: appt } = await admin.from('appointments').select('meeting_url').eq('id', ids.online).single();
  if (appt.meeting_url !== 'https://meet.google.com/abc-defg-hij') fail('Meet: ' + appt.meeting_url);
  const { data: busy } = await admin.from('google_busy').select('starts_at, ends_at').eq('professional_id', ids.professional);
  if (busy.length !== 1 || new Date(busy[0].starts_at).getHours() !== 15) fail('Ocupado: ' + JSON.stringify(busy));
  ok('Sincronização: 2 eventos com título só com iniciais, Meet criado na sessão on-line e salvo; 1 compromisso pessoal como ocupado (livres, cancelados e calendário não marcado ignorados)');

  // 4. Atualização e cancelamento.
  await admin.from('appointments').update({ starts_at: at(1, 11).toISOString(), ends_at: new Date(at(1, 11).getTime() + 50 * 60000).toISOString() }).eq('id', ids.online);
  await admin.from('appointments').update({ status: 'cancelled_by_clinic' }).eq('id', ids.office);
  const before = log.length;
  const sync2 = await (await fetch(fn('google-sync'), { method: 'POST', headers: { 'x-sync-secret': 'segredo-sync-teste' } })).json();
  const calls = log.slice(before).filter((c) => c.path.includes('/events/')).map((c) => c.method).sort().join(',');
  const { count: links } = await admin.from('calendar_event_links').select('appointment_id', { count: 'exact', head: true }).in('appointment_id', [ids.online, ids.office]);
  if (calls !== 'DELETE,PATCH' || links !== 1 || events.size !== 1 || sync2.failed) fail(`Atualização: chamadas ${calls}, vínculos ${links}, eventos ${events.size}`);
  const patched = [...events.values()][0].body;
  if (new Date(patched.start.dateTime).getHours() !== 11 || patched.conferenceData?.createRequest && !patched.hangoutLink) fail('Evento remarcado: ' + JSON.stringify(patched.start));
  ok('Remarcação atualiza o evento (sem criar outro Meet) e o cancelamento remove o evento do Google');

  // 5. Agenda e página no navegador ficam para o roteiro E2E; aqui guardamos o JWT para ele.
  if (process.env.PAUSE_FOR_UI) { console.log('PAUSA_UI'); await new Promise((r) => process.stdin.once('data', r)); }

  // 6. Desconectar.
  const disc = await (await fetch(fn('google-disconnect'), { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: account.id }) })).json();
  const revoked = log.some((c) => c.path === '/revoke' && c.body.includes('mock-refresh-token-secreto'));
  const { count: left } = await admin.from('google_calendars').select('id', { count: 'exact', head: true }).eq('professional_id', ids.professional);
  const { count: busyLeft } = await admin.from('google_busy').select('id', { count: 'exact', head: true }).eq('professional_id', ids.professional);
  if (!disc.ok || disc.removedEvents !== 1 || !revoked || left !== 0 || busyLeft !== 0 || events.size !== 0) fail('Desconexão: ' + JSON.stringify({ disc, revoked, left, busyLeft, events: events.size }));
  ok('Desconexão: evento do sistema removido do Google, autorização revogada, calendários e ocupados apagados');

} catch (error) {
  console.log('✘ Falhou:', error.message);
  process.exitCode = 1;
} finally {
  await cleanup().catch((e) => console.log('limpeza:', e.message));
  for (const child of children) child.kill();
  mock?.close();
  const { count } = await admin.from('google_accounts').select('id', { count: 'exact', head: true });
  console.log('contas Google restantes:', count);
}
