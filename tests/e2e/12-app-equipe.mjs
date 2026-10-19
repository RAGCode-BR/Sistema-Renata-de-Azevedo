// E2E do app da equipe (versão web, largura de celular) contra o Supabase real.
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const PROJECT = process.env.PROJECT_DIR;
const require = createRequire(`${PROJECT}/package.json`);
const puppeteerCore = puppeteer;
const { createClient } = require('@supabase/supabase-js');
const URL_ = process.env.SUPABASE_URL;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [base, ownerEmail, ownerPassword, out] = process.argv.slice(2);
const must = async (q, label) => { const r = await q; if (r.error) throw new Error(label + ': ' + r.error.message); return r; };
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const ids = { professional: crypto.randomUUID(), patient: crypto.randomUUID(), future: crypto.randomUUID(), past: crypto.randomUUID(), user: null };
const PRO_EMAIL = 'teste-app@example.test', PRO_PASSWORD = 'Senha-App-teste-1';

async function cleanup() {
  const { data: charges } = await admin.from('charges').select('id').eq('patient_id', ids.patient);
  const { data: pays } = await admin.from('payments').select('id').eq('patient_id', ids.patient);
  if (pays?.length) await admin.from('payment_allocations').delete().in('payment_id', pays.map((p) => p.id));
  await admin.from('payments').delete().eq('patient_id', ids.patient);
  if (charges?.length) await admin.from('charges').delete().in('id', charges.map((c) => c.id));
  await admin.from('clinical_notes').delete().eq('patient_id', ids.patient).eq('status', 'draft');
  await admin.from('tasks').delete().like('title', '%(app E2E)%');
  await admin.from('appointments').delete().eq('patient_id', ids.patient);
  await admin.from('patient_professionals').delete().eq('patient_id', ids.patient);
  await admin.from('patients').delete().eq('name', 'Paciente App Exemplo');
  const { data: users } = await admin.auth.admin.listUsers();
  for (const u of users.users.filter((x) => x.email === PRO_EMAIL)) await admin.auth.admin.deleteUser(u.id);
  await admin.from('professionals').delete().eq('name', 'Teste App Prof');
  await admin.from('notifications').delete().like('title', '%(app E2E)%');
}

const browser = await puppeteerCore.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('dialog', (d) => d.accept());
const text = () => page.evaluate(() => document.body.innerText.replace(/ /g, ' '));
const waitText = (t, timeout = 15000) => page.waitForFunction((x) => document.body.innerText.replace(/ /g, ' ').includes(x), { timeout, polling: 250 }, t);
const tap = async (label, { exact = true } = {}) => {
  await page.waitForFunction((l, e) => [...document.querySelectorAll('[role=button],[role=tab],[role=checkbox],a')].some((el) => {
    const t = (el.innerText ?? '').replace(/[\uE000-\uF8FF]/g, '').replace(/\u00a0/g, ' ').trim() || el.getAttribute('aria-label') || ''; return e ? t === l : t.includes(l); }), { timeout: 15000, polling: 250 }, label, exact);
  const handle = await page.evaluateHandle((l, e) => {
    const all = [...document.querySelectorAll('[role=button],[role=tab],[role=checkbox],a')].filter((el) => {
      const t = (el.innerText ?? '').replace(/[\uE000-\uF8FF]/g, '').replace(/\u00a0/g, ' ').trim() || el.getAttribute('aria-label') || ''; return e ? t === l : t.includes(l); });
    const visible = all.filter((el) => el.offsetParent !== null);
    return visible.at(-1) ?? all.at(-1);
  }, label, exact);
  await handle.asElement().click();
};
const type = async (label, value) => {
  await page.waitForSelector(`[aria-label="${label}"]`, { timeout: 15000 });
  const handles = await page.$$(`[aria-label="${label}"]`);
  const target = handles.at(-1);
  await target.click({ clickCount: 3 });
  await target.type(value);
};
async function login(email, password) {
  await page.goto(`${base}/login`, { waitUntil: 'networkidle0' });
  await type('E-mail', email);
  await type('Senha', password);
  await tap('Entrar');
  await waitText('Olá,');
}

try {
  await cleanup();
  await must(admin.from('professionals').insert({ id: ids.professional, name: 'Teste App Prof' }), 'profissional');
  const { data: created } = await admin.auth.admin.createUser({ email: PRO_EMAIL, password: PRO_PASSWORD, email_confirm: true,
    user_metadata: { name: 'Teste App Prof' }, app_metadata: { roles: ['professional'], professional_id: ids.professional } });
  ids.user = created.user.id;
  await must(admin.from('patients').insert({ id: ids.patient, name: 'Paciente App Exemplo', phone: '(21) 96666-1212' }), 'paciente');
  await must(admin.from('patient_professionals').insert({ patient_id: ids.patient, professional_id: ids.professional }), 'vínculo');
  const later = new Date(); later.setHours(later.getHours() + 3, 0, 0, 0);
  const past = new Date(); past.setHours(past.getHours() - 3, 0, 0, 0);
  await must(admin.from('appointments').insert([
    { id: ids.future, patient_id: ids.patient, professional_id: ids.professional, starts_at: later.toISOString(), ends_at: new Date(later.getTime() + 50 * 60000).toISOString(), status: 'scheduled', modality: 'presencial', meeting_url: null },
    { id: ids.past, patient_id: ids.patient, professional_id: ids.professional, starts_at: past.toISOString(), ends_at: new Date(past.getTime() + 50 * 60000).toISOString(), status: 'scheduled', modality: 'presencial', meeting_url: null }
  ]), 'sessões');
  await must(admin.from('tasks').insert({ title: 'Ligar para o laboratório (app E2E)', assignee_id: ids.user, created_by: ids.user, priority: 'high' }), 'tarefa');
  await must(admin.from('charges').insert({ patient_id: ids.patient, professional_id: ids.professional, description: 'Pacote (app E2E)', competence_date: new Date().toISOString().slice(0, 10),
    due_date: new Date().toISOString().slice(0, 10), amount: 300 }), 'cobrança');

  // Proprietária: início, agenda, sessão (confirmar e presença), pacientes, cobrança.
  await login(ownerEmail, ownerPassword);
  for (const tab of ['Início', 'Agenda', 'Pacientes', 'Tarefas', 'Mais']) if (!(await text()).includes(tab)) throw new Error('Aba ausente: ' + tab);
  await page.screenshot({ path: `${out}/app-inicio.png` });
  ok('Login com a conta do sistema; abas Início, Agenda, Pacientes, Tarefas e Mais');

  await tap('Agenda');
  await waitText('Paciente App Exemplo');
  await page.screenshot({ path: `${out}/app-agenda.png` });
  await tap(`${later.toTimeString().slice(0, 5)} · Paciente App Exemplo`, { exact: false });
  await waitText('Confirmar sessão');
  await tap('Confirmar sessão');
  await page.waitForFunction(() => document.body.innerText.includes('Confirmada'), { timeout: 15000 });
  const { data: confirmed } = await admin.from('appointments').select('status').eq('id', ids.future).single();
  if (confirmed.status !== 'confirmed') throw new Error('Sessão não confirmada: ' + confirmed.status);
  ok('Agenda do dia; sessão aberta e confirmada pelo app');

  await page.goto(`${base}/sessao/${ids.past}`, { waitUntil: 'networkidle0' });
  await waitText('Realizada');
  await tap('Realizada');
  await page.waitForFunction(() => document.body.innerText.includes('Situação') && !document.body.innerText.includes('Faltou'), { timeout: 15000 });
  const { data: done } = await admin.from('appointments').select('status').eq('id', ids.past).single();
  if (done.status !== 'completed') throw new Error('Presença não registrada: ' + done.status);
  ok('Presença registrada na sessão que já aconteceu');

  await page.goto(`${base}/pacientes`, { waitUntil: 'networkidle0' });
  await type('Buscar por nome ou telefone', 'app exemplo');
  await tap('Paciente App Exemplo', { exact: false });
  await waitText('(21) 96666-1212');
  await waitText('WhatsApp');
  ok('Busca de paciente e ficha com telefone, Ligar e WhatsApp');

  await page.goto(`${base}/cobrancas`, { waitUntil: 'networkidle0' });
  await tap('Paciente App Exemplo · R$ 300,00', { exact: false });
  await type('Valor recebido', '100');
  await tap('Registrar pagamento');
  await waitText('Paciente App Exemplo · R$ 200,00');
  ok('Cobranças em aberto: pagamento de R$ 100,00 registrado pelo app (restam R$ 200,00)');

  await page.goto(`${base}/mais`, { waitUntil: 'networkidle0' });
  await tap('Sair da conta');
  await page.waitForFunction(() => document.body.innerText.includes('Entrar no app da equipe'), { timeout: 15000 });

  // Profissional: pendências, tarefa, rascunho de evolução; sem cobranças.
  await login(PRO_EMAIL, PRO_PASSWORD);
  await waitText('Escrever evolução: Paciente App Exemplo');
  await page.waitForFunction(() => /1\s*tarefas em aberto/.test(document.body.innerText), { timeout: 15000 });
  ok('Profissional: pendências mostram a evolução a escrever; contador de tarefas em aberto');

  await tap('Escrever evolução: Paciente App Exemplo', { exact: false });
  await type('Evolução (rascunho)', 'Paciente relatou melhora do sono. (rascunho pelo app)');
  await tap('Salvar rascunho');
  await page.waitForFunction(() => !document.body.innerText.includes('Salvar rascunho'), { timeout: 15000 });
  const { data: notes } = await admin.from('clinical_notes').select('status, body').eq('patient_id', ids.patient);
  if (notes.length !== 1 || notes[0].status !== 'draft') throw new Error('Rascunho: ' + JSON.stringify(notes));
  ok('Rascunho de evolução salvo pelo app (fica como rascunho; finalizar só no computador)');

  await page.goto(`${base}/tarefas`, { waitUntil: 'networkidle0' });
  await tap('Concluir: Ligar para o laboratório (app E2E)');
  await page.waitForFunction(() => document.querySelector('[role=checkbox][aria-checked=true]') || !document.body.innerText.includes('Ligar para o laboratório'), { timeout: 15000 });
  const { data: task } = await admin.from('tasks').select('status').like('title', 'Ligar para o laboratório (app E2E)').single();
  if (task.status !== 'done') throw new Error('Tarefa: ' + task.status);
  await tap('Nova tarefa');
  await type('Título', 'Enviar relatório (app E2E)');
  await tap('Criar tarefa');
  await page.waitForFunction(() => document.body.innerText.includes('Enviar relatório (app E2E)'), { timeout: 15000 });
  ok('Tarefa concluída pelo check e nova tarefa criada');

  await page.goto(`${base}/mais`, { waitUntil: 'networkidle0' });
  await waitText('Meu repasse');
  if ((await text()).includes('Cobranças em aberto')) throw new Error('Profissional viu Cobranças');
  await page.screenshot({ path: `${out}/app-mais.png` });
  ok('Profissional: "Meu repasse" no menu e sem Cobranças');

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
  await waitText('Olá,');
  await page.screenshot({ path: `${out}/app-escuro.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error('Rolagem horizontal: ' + overflow);
  ok('Modo escuro do celular e sem rolagem lateral');
  console.log(problems.length ? 'Erros de página: ' + problems.join(' | ') : 'Sem erros de página');
} catch (error) {
  console.log('✘ Falhou:', error.message);
  await page.screenshot({ path: `${out}/app-falha.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await cleanup().catch((e) => console.log('limpeza:', e.message));
}
