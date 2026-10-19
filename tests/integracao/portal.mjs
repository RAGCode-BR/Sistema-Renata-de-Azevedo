// Teste de integração do portal: funções reais (Deno, local) + banco real + serviço de e-mail simulado.
// Rodado por tests/run.mjs (variáveis de ambiente preenchidas por ele; a chave nunca é impressa).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import http from 'node:http';

const PROJECT = process.env.PROJECT_DIR;
const { createClient } = createRequire(`${PROJECT}/package.json`)('@supabase/supabase-js');
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const fail = (m) => { throw new Error(m); };
const must = async (q, label) => { const r = await q; if (r.error) throw new Error(label + ': ' + r.error.message); return r; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STAFF = { email: 'teste-portal-recepcao@example.test', password: 'Senha-Portal-ok-1' };
const PROF = { email: 'teste-portal-prof@example.test', password: 'Senha-Portal-ok-2' };
const PATIENT_EMAIL = 'teste-portal-paciente@example.test';
const ids = {};
const sent = [];
const ports = { 'portal-invite': 8821, 'portal-document-url': 8822, 'portal-email-send': 8823 };
const fn = (name) => `http://127.0.0.1:${ports[name]}`;
const children = [];
let original;

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c)).on('end', () => {
    sent.push({ auth: req.headers.authorization, path: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: `email-${sent.length}` }));
  });
});

async function cleanup() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const mine = users.users.filter((u) => [STAFF.email, PROF.email, PATIENT_EMAIL].includes(u.email));
  const { data: patients } = await admin.from('patients').select('id').in('name', ['Paciente Portal E2E', 'Outro Paciente Portal E2E']);
  const patientIds = (patients ?? []).map((p) => p.id);
  if (patientIds.length) {
    const { data: docs } = await admin.from('portal_documents').select('storage_path').in('patient_id', patientIds);
    if (docs?.length) await admin.storage.from('portal-documents').remove(docs.map((d) => d.storage_path));
    const { data: reqs } = await admin.from('portal_requests').select('task_id').in('patient_id', patientIds);
    await admin.from('portal_requests').delete().in('patient_id', patientIds);
    const tasks = (reqs ?? []).map((r) => r.task_id).filter(Boolean);
    if (tasks.length) {
      await admin.from('notifications').delete().in('link', tasks.map((t) => `#/tarefas?tarefa=${t}`));
      await admin.from('tasks').delete().in('id', tasks);
    }
    await admin.from('portal_documents').delete().in('patient_id', patientIds);
    await admin.from('portal_access').delete().in('patient_id', patientIds);
    await admin.from('appointments').delete().in('patient_id', patientIds);
    await admin.from('patient_professionals').delete().in('patient_id', patientIds);
    await admin.from('patients').delete().in('id', patientIds);
  }
  for (const user of mine) {
    await admin.from('portal_email_outbox').delete().eq('user_id', user.id);
    await admin.from('notifications').delete().eq('user_id', user.id);
    await admin.auth.admin.deleteUser(user.id);
  }
  await admin.from('professionals').delete().eq('name', 'Teste Portal Prof');
  if (original) {
    await admin.from('clinic_settings').update(original.settings).eq('id', true);
    await admin.from('integration_state').update(original.email).eq('key', 'portal_email');
  }
}

async function signIn(email, password) {
  const client = createClient(URL_, ANON, { auth: { persistSession: false } });
  await must(client.auth.signInWithPassword({ email, password }), 'login ' + email);
  return client;
}
async function call(name, client, body, headers = {}) {
  const token = client ? (await client.auth.getSession()).data.session.access_token : null;
  const res = await fetch(fn(name), { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

try {
  await new Promise((r) => mock.listen(9922, r));
  const env = {
    ...process.env, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY: ANON, NO_COLOR: '1',
    PORTAL_EMAIL_SECRET: 'segredo-email-teste', RESEND_API_KEY: 're_teste', PORTAL_EMAIL_FROM: 'Clínica <portal@example.test>',
    RESEND_API_URL: 'http://127.0.0.1:9922'
  };
  for (const [name, port] of Object.entries(ports)) {
    const child = spawn(process.env.DENO_BIN, ['run', '--node-modules-dir=none', '--allow-net', '--allow-env', '--allow-read', `${PROJECT}/supabase/functions/${name}/index.ts`],
      { cwd: process.env.WORK_DIR, env: { ...env, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${port}` }, stdio: process.env.VERBOSE ? 'inherit' : 'ignore' });
    children.push(child);
  }
  for (const name of Object.keys(ports)) {
    for (let i = 0; i < 120; i++) { try { await fetch(fn(name), { method: 'OPTIONS' }); break; } catch { await sleep(500); } }
  }
  await cleanup();
  const { data: settings } = await admin.from('clinic_settings').select('portal_enabled, portal_url, portal_payment_instructions, portal_assignee_id').single();
  const { data: email } = await admin.from('integration_state').select('enabled, last_run_at, last_error').eq('key', 'portal_email').single();
  original = { settings, email };

  // Cenário: recepção, profissional, paciente adulto e outro paciente.
  const { data: prof } = await must(admin.from('professionals').insert({ name: 'Teste Portal Prof' }).select('id').single(), 'profissional');
  ids.prof = prof.id;
  const { data: staff } = await must(admin.auth.admin.createUser({ email: STAFF.email, password: STAFF.password, email_confirm: true,
    user_metadata: { name: 'Teste Portal Recepção' }, app_metadata: { roles: ['reception'] } }), 'recepção');
  ids.staff = staff.user.id;
  await must(admin.auth.admin.createUser({ email: PROF.email, password: PROF.password, email_confirm: true,
    user_metadata: { name: 'Teste Portal Prof' }, app_metadata: { roles: ['professional'], professional_id: ids.prof } }), 'conta profissional');
  const { data: patient } = await must(admin.from('patients').insert({ name: 'Paciente Portal E2E', email: PATIENT_EMAIL, birth_date: '1990-05-01' }).select('id').single(), 'paciente');
  const { data: other } = await must(admin.from('patients').insert({ name: 'Outro Paciente Portal E2E' }).select('id').single(), 'outro');
  ids.patient = patient.id; ids.other = other.id;
  await must(admin.from('patient_professionals').insert([{ patient_id: ids.patient, professional_id: ids.prof }, { patient_id: ids.other, professional_id: ids.prof }]), 'vínculos');
  await must(admin.from('clinic_settings').update({ portal_enabled: true, portal_url: 'https://portal.example.test' }).eq('id', true), 'ligar portal');
  await must(admin.from('integration_state').update({ enabled: true }).eq('key', 'portal_email'), 'ligar e-mail');

  const reception = await signIn(STAFF.email, STAFF.password);
  const professional = await signIn(PROF.email, PROF.password);

  // 1. Convite.
  const denied = await call('portal-invite', professional, { patientId: ids.patient, email: PATIENT_EMAIL, relationship: 'self' });
  const anonymous = await call('portal-invite', null, { patientId: ids.patient, email: PATIENT_EMAIL, relationship: 'self' });
  if (denied.status !== 403 || anonymous.status !== 401) fail(`recusas do convite: ${denied.status} ${anonymous.status}`);
  const invited = await call('portal-invite', reception, { patientId: ids.patient, email: PATIENT_EMAIL.toUpperCase(), relationship: 'self' });
  if (invited.status !== 201 || !invited.body.created) fail('convite: ' + JSON.stringify(invited));
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const account = users.find((u) => u.email === PATIENT_EMAIL);
  ids.patientUser = account?.id;
  const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', ids.patientUser);
  const { data: access } = await admin.from('portal_access').select('relationship, invited_by').eq('patient_id', ids.patient);
  if (JSON.stringify(roles) !== '[{"role":"patient"}]' || access.length !== 1 || access[0].invited_by !== ids.staff
    || account.app_metadata.roles?.join() !== 'patient' || account.user_metadata.name !== 'Paciente Portal E2E') fail('conta criada: ' + JSON.stringify({ roles, access }));
  ok('Convite pela recepção: conta só com perfil Paciente, sem senha, vinculada ao paciente; profissional e anônimo recusados');

  const again = await call('portal-invite', reception, { patientId: ids.patient, email: PATIENT_EMAIL, relationship: 'self' });
  const staffEmail = await call('portal-invite', reception, { patientId: ids.other, email: PROF.email, relationship: 'self' });
  if (again.status !== 400 || !/já tem acesso/.test(again.body.error) || staffEmail.status !== 400 || !/equipe/.test(staffEmail.body.error)) {
    fail('regras do convite: ' + JSON.stringify([again, staffEmail]));
  }
  const second = await call('portal-invite', reception, { patientId: ids.other, email: PATIENT_EMAIL, relationship: 'guardian' });
  if (second.status !== 201 || second.body.created) fail('segundo vínculo: ' + JSON.stringify(second));
  ok('Convite repetido e e-mail da equipe recusados com mensagem clara; conta existente ganha só o novo vínculo (responsável por outro paciente)');

  // 2. Entrada por código (gerado pelo admin, como se tivesse chegado no e-mail).
  const portal = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error: otpError } = await portal.auth.signInWithOtp({ email: 'ninguem-cadastrado@example.test', options: { shouldCreateUser: false } });
  const { data: { users: after } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (after.some((u) => u.email === 'ninguem-cadastrado@example.test')) fail('código pedido criou conta nova');
  const { data: link } = await must(admin.auth.admin.generateLink({ type: 'magiclink', email: PATIENT_EMAIL }), 'código');
  await must(portal.auth.verifyOtp({ email: PATIENT_EMAIL, token: link.properties.email_otp, type: 'email' }), 'entrar com código');
  const { error: wrong } = await createClient(URL_, ANON, { auth: { persistSession: false } }).auth.verifyOtp({ email: PATIENT_EMAIL, token: '000000', type: 'email' });
  if (!wrong) fail('código errado aceito');
  ok(`Entrada por código: e-mail não cadastrado não cria conta (${otpError ? 'recusado' : 'resposta neutra'}), código certo entra, código errado não`);

  // 3. Documento compartilhado e link temporário.
  const file = new Blob(['%PDF-1.4 documento de teste do portal'], { type: 'application/pdf' });
  const path = `patients/${ids.patient}/${crypto.randomUUID()}.pdf`;
  await must(professional.storage.from('portal-documents').upload(path, file, { contentType: 'application/pdf' }), 'envio pela profissional');
  const { data: docId } = await must(professional.rpc('share_portal_document', { p_patient_id: ids.patient, p_title: 'Declaração de comparecimento', p_path: path, p_size: file.size, p_mime: 'application/pdf' }), 'compartilhar');
  const otherPath = `patients/${ids.other}/${crypto.randomUUID()}.pdf`;
  await must(professional.storage.from('portal-documents').upload(otherPath, file, { contentType: 'application/pdf' }), 'envio 2');
  const { data: otherDoc } = await must(professional.rpc('share_portal_document', { p_patient_id: ids.other, p_title: 'Material do outro', p_path: otherPath, p_size: file.size, p_mime: 'application/pdf' }), 'compartilhar 2');
  const direct = await portal.storage.from('portal-documents').download(path);
  const beforeTerms = await call('portal-document-url', portal, { documentId: docId });
  if (!direct.error || beforeTerms.status !== 403) fail('acesso sem termos ou direto ao bucket: ' + beforeTerms.status);
  await must(portal.rpc('portal_accept_terms', { p_version: (await portal.rpc('portal_me')).data.terms_version }), 'termos');
  const opened = await call('portal-document-url', portal, { documentId: docId });
  const content = opened.body.url ? await (await fetch(opened.body.url)).text() : '';
  if (opened.status !== 200 || !content.includes('documento de teste')) fail('download: ' + JSON.stringify(opened));
  const { count: downloads } = await admin.from('portal_document_downloads').select('id', { count: 'exact', head: true }).eq('document_id', docId);
  const staffOpen = await call('portal-document-url', professional, { documentId: docId });
  if (downloads !== 1 || staffOpen.status !== 200) fail(`registro de download ${downloads}, equipe ${staffOpen.status}`);
  ok('Documento: paciente não lê o bucket direto nem baixa antes dos termos; depois baixa por link temporário (download registrado); a profissional confere o arquivo');

  // 4. Acesso revogado ao outro paciente: documento dele deixa de abrir.
  const otherOk = await call('portal-document-url', portal, { documentId: otherDoc });
  const { data: otherAccess } = await admin.from('portal_access').select('id').eq('patient_id', ids.other).single();
  await must(reception.rpc('revoke_portal_access', { p_id: otherAccess.id }), 'revogar');
  const otherDenied = await call('portal-document-url', portal, { documentId: otherDoc });
  if (otherOk.status !== 200 || otherDenied.status !== 403) fail(`revogação: ${otherOk.status} ${otherDenied.status}`);
  ok('Revogação: o documento do outro paciente abria e deixa de abrir na hora');

  // 5. E-mails: convite + novidade, texto genérico; segredo obrigatório.
  const noSecret = await call('portal-email-send', null, {}, { 'x-sync-secret': 'errado' });
  const run = await call('portal-email-send', null, {}, { 'x-sync-secret': 'segredo-email-teste' });
  const { data: outbox } = await admin.from('portal_email_outbox').select('kind, status').eq('user_id', ids.patientUser).order('id');
  const toPatient = sent.filter((s) => s.body.to?.[0] === PATIENT_EMAIL);
  const allText = JSON.stringify(toPatient);
  if (noSecret.status !== 401 || run.status !== 200 || !outbox.length || outbox.some((o) => o.status !== 'sent')
    || !toPatient.some((s) => s.body.subject === 'Seu acesso ao portal do paciente') || !toPatient.some((s) => s.body.subject === 'Novidade no portal do paciente')
    || toPatient.some((s) => s.auth !== 'Bearer re_teste' || s.path !== '/emails' || s.body.from !== 'Clínica <portal@example.test>')
    || /Declaração|Material|Teste Portal Prof/.test(allText) || !allText.includes('https://portal.example.test')) {
    fail('e-mails: ' + JSON.stringify({ noSecret: noSecret.status, run, outbox, toPatient }));
  }
  ok(`E-mails pelo serviço configurado: ${toPatient.length} enviados (convite e novidade), sem título de documento nem nome da profissional; sem o segredo, recusado`);

  console.log('Sem erros');
} catch (error) {
  console.log('✘ Falhou: ' + error.message);
} finally {
  await cleanup().catch((e) => console.log('limpeza: ' + e.message));
  const { count } = await admin.from('patients').select('id', { count: 'exact', head: true }).like('name', '%Portal E2E');
  console.log(`dados de teste restantes: ${count}`);
  children.forEach((c) => c.kill());
  mock.close();
}
