// Teste de ponta a ponta do portal: sistema web (localhost) + Supabase real + funções publicadas.
// Rodado por tests/run.mjs (variáveis de ambiente preenchidas por ele; a chave nunca é impressa).
import puppeteer from 'puppeteer-core';
import { createRequire } from 'node:module';

const PROJECT = process.env.PROJECT_DIR;
const { createClient } = createRequire(`${PROJECT}/package.json`)('@supabase/supabase-js');
const URL_ = process.env.SUPABASE_URL;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const [base] = process.argv.slice(2);
const SHOTS = process.env.SHOT_DIR;
const STAFF = { email: 'teste-portal-recepcao@example.test', password: 'Senha-Portal-ok-1' };
const PATIENT_EMAIL = 'teste-portal-paciente@example.test';
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const fail = (m) => { throw new Error(m); };
const must = async (q, label) => { const r = await q; if (r.error) throw new Error(label + ': ' + r.error.message); return r; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = {};
let original;
const problems = [];
let current;

async function cleanup() {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const mine = users.users.filter((u) => [STAFF.email, PATIENT_EMAIL].includes(u.email));
  const { data: patients } = await admin.from('patients').select('id').eq('name', 'Paciente Portal E2E');
  const patientIds = (patients ?? []).map((p) => p.id);
  if (patientIds.length) {
    const { data: docs } = await admin.from('portal_documents').select('storage_path').in('patient_id', patientIds);
    if (docs?.length) await admin.storage.from('portal-documents').remove(docs.map((d) => d.storage_path));
    const { data: reqs } = await admin.from('portal_requests').select('task_id').in('patient_id', patientIds);
    await admin.from('portal_requests').delete().in('patient_id', patientIds);
    const tasks = (reqs ?? []).map((r) => r.task_id).filter(Boolean);
    if (tasks.length) {
      await admin.from('notifications').delete().in('link', tasks.map((t) => `#/tarefas?tarefa=${t}`));
      await admin.from('task_events').delete().in('task_id', tasks);
      await admin.from('tasks').delete().in('id', tasks);
    }
    await admin.from('portal_documents').delete().in('patient_id', patientIds);
    await admin.from('portal_access').delete().in('patient_id', patientIds);
    const { data: charges } = await admin.from('charges').select('id').in('patient_id', patientIds);
    const { data: payments } = await admin.from('payments').select('id').in('patient_id', patientIds);
    if (payments?.length) await admin.from('payment_allocations').delete().in('payment_id', payments.map((p) => p.id));
    await admin.from('payments').delete().in('patient_id', patientIds);
    if (charges?.length) await admin.from('charges').delete().in('id', charges.map((c) => c.id));
    const { data: appts } = await admin.from('appointments').select('id').in('patient_id', patientIds);
    if (appts?.length) await admin.from('appointment_events').delete().in('appointment_id', appts.map((a) => a.id));
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
  if (original) await admin.from('clinic_settings').update(original).eq('id', true);
}

const text = (page) => page.evaluate(() => document.body.innerText.replace(/ /g, ' '));
const waitText = (page, t, timeout = 15000) => page.waitForFunction((x) => document.body.innerText.replace(/ /g, ' ').includes(x), { timeout, polling: 200 }, t);
async function clickText(page, selector, label) {
  const handle = await page.waitForFunction((s, x) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === x && !e.disabled), { timeout: 15000 }, selector, label);
  await handle.asElement().click();
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
try {
  await cleanup();
  const { data: settings } = await admin.from('clinic_settings').select('portal_enabled, portal_url, portal_payment_instructions, portal_assignee_id').single();
  original = settings;

  // Cenário: profissional, paciente adulto com sessões e cobrança parcialmente paga; recepção; portal ligado.
  const { data: prof } = await must(admin.from('professionals').insert({ name: 'Teste Portal Prof' }).select('id').single(), 'profissional');
  await must(admin.auth.admin.createUser({ email: STAFF.email, password: STAFF.password, email_confirm: true,
    user_metadata: { name: 'Teste Portal Recepção' }, app_metadata: { roles: ['reception'] } }), 'recepção');
  const { data: patient } = await must(admin.from('patients').insert({ name: 'Paciente Portal E2E', email: PATIENT_EMAIL, birth_date: '1990-05-01' }).select('id').single(), 'paciente');
  ids.patient = patient.id;
  await must(admin.from('patient_professionals').insert({ patient_id: ids.patient, professional_id: prof.id }), 'vínculo');
  const at = (days, hour) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); return d; };
  const soon = new Date(Date.now() + 30 * 60000); soon.setSeconds(0, 0);
  const { data: appts } = await must(admin.from('appointments').insert([
    { patient_id: ids.patient, professional_id: prof.id, starts_at: soon.toISOString(), ends_at: new Date(soon.getTime() + 50 * 60000).toISOString(), modality: 'online', status: 'confirmed' },
    { patient_id: ids.patient, professional_id: prof.id, starts_at: at(3, 15).toISOString(), ends_at: new Date(at(3, 15).getTime() + 50 * 60000).toISOString(), modality: 'presencial', status: 'scheduled' },
    { patient_id: ids.patient, professional_id: prof.id, starts_at: at(10, 15).toISOString(), ends_at: new Date(at(10, 15).getTime() + 50 * 60000).toISOString(), modality: 'presencial', status: 'scheduled' }
  ]).select('id, starts_at').order('starts_at'), 'sessões');
  await must(admin.from('appointments').update({ meeting_url: 'https://meet.google.com/abc-defg-hij' }).eq('id', appts[0].id), 'meet');
  const today = new Date().toISOString().slice(0, 10);
  const { data: charge } = await must(admin.from('charges').insert({ patient_id: ids.patient, professional_id: prof.id, description: 'Sessão de outubro', competence_date: today, due_date: today, amount: 300 }).select('id').single(), 'cobrança');
  const { data: payment } = await must(admin.from('payments').insert({ patient_id: ids.patient, amount: 150, method: 'pix', received_at: today, notes: 'Nota interna E2E' }).select('id').single(), 'pagamento');
  await must(admin.from('payment_allocations').insert({ payment_id: payment.id, charge_id: charge.id, amount: 150 }), 'alocação');
  await must(admin.from('clinic_settings').update({ portal_enabled: true, portal_payment_instructions: 'PIX (CNPJ): 00.000.000/0001-00\nDepois de pagar, toque em Já paguei.' }).eq('id', true), 'ligar portal');

  // 1. Equipe: convite e documento pela aba Portal da ficha.
  const staff = await browser.newPage();
  staff.on('pageerror', (e) => problems.push(e.message));
  await staff.setViewport({ width: 1366, height: 900 });
  await staff.goto(base, { waitUntil: 'networkidle0' });
  await staff.type('input[name=email]', STAFF.email);
  await staff.type('input[name=password]', STAFF.password);
  await staff.click('button[type=submit]');
  await staff.waitForSelector('.rail-link');
  await staff.goto(`${base}/#/pacientes?id=${ids.patient}&aba=portal`, { waitUntil: 'networkidle0' });
  await waitText(staff, 'Ninguém tem acesso ao portal deste paciente.');
  const prefilled = await staff.$eval('input[name=email]', (e) => e.value);
  if (prefilled !== PATIENT_EMAIL) fail('e-mail sugerido: ' + prefilled);
  await clickText(staff, 'button', 'Liberar acesso ao portal');
  await waitText(staff, 'ainda não entrou');
  const input = await staff.$('input[type=file][name=file]');
  await input.uploadFile(process.env.FILE);
  await staff.type('input[name=title]', 'Declaração de comparecimento E2E');
  await clickText(staff, 'button', 'Compartilhar com o paciente');
  await waitText(staff, 'Declaração de comparecimento E2E');
  if (!(await text(staff)).includes('Ainda não')) fail('documento sem situação de abertura');
  ok('Equipe: na aba Portal, o e-mail do paciente vem sugerido; acesso liberado ("ainda não entrou") e documento compartilhado');

  // 2. Paciente: entrada por código no celular.
  const context = await browser.createBrowserContext();
  const phone = await context.newPage();
  current = phone;
  if (process.env.VERBOSE) phone.on('response', (r) => { if (r.url().includes('/auth/v1/')) console.log('auth:', r.status(), r.url().replace(/\?.*/, '')); });
  phone.on('pageerror', (e) => problems.push(e.message));
  await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await phone.goto(`${base}/#/portal`, { waitUntil: 'networkidle0' });
  await waitText(phone, 'Portal do paciente');
  await phone.screenshot({ path: `${SHOTS}/portal-entrada.png` });
  await phone.type('input[name=email]', PATIENT_EMAIL);
  await clickText(phone, 'button', 'Receber código');
  await waitText(phone, 'Digite o código');
  let code;
  for (let i = 0; i < 20 && !code; i++) {
    const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: PATIENT_EMAIL });
    if (data?.properties?.email_otp) code = data.properties.email_otp; else { if (i === 19) fail('código: ' + error?.message); await sleep(5000); }
  }
  await phone.type('input[name=code]', '000000');
  await clickText(phone, 'button', 'Entrar');
  await waitText(phone, 'Código inválido ou vencido');
  await phone.$eval('input[name=code]', (e) => { e.value = ''; });
  await phone.type('input[name=code]', code);
  await clickText(phone, 'button', 'Entrar');
  await waitText(phone, 'Termos de uso do portal');
  const continueDisabled = await phone.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continuar').disabled);
  if (!continueDisabled) fail('Continuar habilitado sem marcar o aceite');
  await phone.screenshot({ path: `${SHOTS}/portal-termos.png` });
  await phone.click('.portal-terms input[type=checkbox]');
  await clickText(phone, 'button', 'Continuar');
  await waitText(phone, 'Olá, Paciente!');
  await waitText(phone, 'R$ 150,00');
  await sleep(500);
  await phone.screenshot({ path: `${SHOTS}/portal-inicio.png` });
  ok('Paciente: entra só com código (código errado recusado), aceita os termos (botão só libera com o aceite) e vê a próxima sessão e R$ 150,00 em aberto');

  // 3. Sessões: link do Meet perto do horário, confirmar e pedir remarcação.
  await phone.goto(`${base}/#/portal/consultas`, { waitUntil: 'networkidle0' });
  await waitText(phone, 'Entrar na sessão on-line');
  const meet = await phone.$eval('a.button[href*="meet.google.com"]', (a) => a.href);
  await clickText(phone, 'button', 'Confirmar presença');
  await waitText(phone, 'Sessão confirmada. Obrigado!');
  const buttons = await phone.$$eval('button', (els) => els.filter((b) => b.textContent.trim() === 'Preciso remarcar ou cancelar').length);
  await (await phone.$$('xpath/.//button[normalize-space()="Preciso remarcar ou cancelar"]')).at(-1).click();
  await waitText(phone, 'Remarcar ou cancelar');
  await phone.type('dialog[open] textarea[name=message]', 'Prefiro horários à tarde.');
  await clickText(phone, 'dialog[open] button', 'Enviar pedido');
  await waitText(phone, 'pedido de alteração enviado');
  await phone.screenshot({ path: `${SHOTS}/portal-sessoes.png`, fullPage: true });
  const { data: states } = await admin.from('appointments').select('status').eq('patient_id', ids.patient).order('starts_at');
  if (!meet.includes('abc-defg-hij') || buttons !== 3 || states.map((s) => s.status).join() !== 'confirmed,confirmed,scheduled') {
    fail('sessões: ' + JSON.stringify({ meet, buttons, states }));
  }
  ok('Sessões: link do Meet só na sessão que começa em 30 min; confirmação grava na agenda; pedido de remarcação enviado sem mexer na agenda');

  // 4. Financeiro: instruções, saldo e "Já paguei".
  await phone.goto(`${base}/#/portal/financeiro`, { waitUntil: 'networkidle0' });
  await waitText(phone, 'PIX (CNPJ)');
  await waitText(phone, 'Parcialmente paga');
  const finance = await text(phone);
  if (!finance.includes('Parcialmente paga · falta R$ 150,00') || !finance.includes('PIX') || finance.includes('Nota interna')) fail('financeiro: ' + finance);
  await clickText(phone, 'button', 'Já paguei');
  await phone.type('dialog[open] textarea[name=message]', 'Paguei o restante por PIX.');
  await clickText(phone, 'dialog[open] button', 'Enviar aviso');
  await waitText(phone, 'Você avisou o pagamento em');
  await phone.screenshot({ path: `${SHOTS}/portal-financeiro.png`, fullPage: true });
  ok('Financeiro: instruções de pagamento, cobrança parcialmente paga (falta R$ 150,00), pagamento recebido sem observação interna; aviso "Já paguei" enviado');

  // 5. Documentos: abrir por link temporário.
  await phone.goto(`${base}/#/portal/documentos`, { waitUntil: 'networkidle0' });
  await waitText(phone, 'Declaração de comparecimento E2E');
  if (!(await text(phone)).includes('novo')) fail('documento sem marca de novo');
  const opened = new Promise((resolve) => context.once('targetcreated', resolve));
  await clickText(phone, 'button', 'Abrir');
  const target = await opened;
  let url = '';
  for (let i = 0; i < 40 && !url.includes('/storage/v1/object/sign/portal-documents/'); i++) { await sleep(250); url = target.url(); }
  if (!url.includes('/storage/v1/object/sign/portal-documents/')) fail('link do documento: ' + url);
  const body = await (await fetch(url)).text();
  if (!body.includes('Declaração de teste do portal')) fail('conteúdo do documento');
  await (await target.page())?.close();
  await phone.reload({ waitUntil: 'networkidle0' });
  await waitText(phone, 'Declaração de comparecimento E2E');
  if ((await text(phone)).includes('novo')) fail('documento continua como novo depois de aberto');
  ok('Documentos: abre em nova aba por link assinado de 60 s com o arquivo certo; depois de aberto, deixa de aparecer como "novo"');

  // 6. Avisos e layout no celular.
  await phone.goto(`${base}/#/portal/avisos`, { waitUntil: 'networkidle0' });
  await waitText(phone, 'Novo documento: Declaração de comparecimento E2E');
  const wide = [];
  for (const path of ['inicio', 'consultas', 'financeiro', 'documentos', 'avisos']) {
    await phone.goto(`${base}/#/portal/${path}`, { waitUntil: 'networkidle0' });
    await sleep(300);
    if (!(await noSideScroll(phone))) wide.push(path);
  }
  if (wide.length) fail('rolagem lateral em: ' + wide.join(', '));
  ok('Avisos mostram o documento novo; nenhuma tela do portal tem rolagem lateral a 390 px');

  // 7. Equipe vê pedidos, tarefas e o download; encerra o acesso.
  await staff.reload({ waitUntil: 'networkidle0' });
  await waitText(staff, 'Pedidos feitos pelo portal');
  const panel = await text(staff);
  const { data: tasks } = await admin.from('tasks').select('title').eq('patient_id', ids.patient);
  if (!panel.includes('Remarcar sessão') || !panel.includes('Avisou pagamento') || !panel.includes('aceitou os termos')
    || !panel.includes('"Prefiro horários à tarde."') || panel.includes('Ainda não') || tasks.length !== 2) {
    fail('visão da equipe: ' + JSON.stringify(tasks));
  }
  await staff.screenshot({ path: `${SHOTS}/portal-equipe.png`, fullPage: true });
  await clickText(staff, 'button', 'Encerrar acesso');
  await clickText(staff, 'dialog[open] button', 'Encerrar acesso');
  await waitText(staff, 'acesso encerrado em');
  await phone.goto(`${base}/#/portal/inicio`, { waitUntil: 'networkidle0' });
  await phone.reload({ waitUntil: 'networkidle0' });
  await waitText(phone, 'Sem acesso no momento');
  ok('Equipe: pedidos (remarcar com a mensagem, aviso de pagamento) viraram 2 tarefas, termos aceitos e download registrados; acesso encerrado e o paciente perde o portal na hora');

  // 8. Conta do portal não entra no sistema da equipe; Configurações mostram o painel do portal.
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const patientUser = users.users.find((u) => u.email === PATIENT_EMAIL);
  await phone.goto(`${base}/#/`, { waitUntil: 'networkidle0' });
  const staffArea = await phone.evaluate(() => Boolean(document.querySelector('.rail-link')));
  if (staffArea || !patientUser) fail('conta de paciente abriu o sistema da equipe');
  ok('A sessão do paciente não abre o sistema da equipe');
  if (problems.length) fail('erros na página: ' + problems.join(' | '));
  console.log('Sem erros de página');
} catch (error) {
  console.log('✘ Falhou: ' + error.message);
  if (current) console.log('TELA: ' + (await current.evaluate(() => document.body.innerText + ' | campo=' + JSON.stringify([...document.querySelectorAll('input')].map((i) => [i.name, i.value, i.validationMessage]))).catch(() => '')).slice(0, 900));
} finally {
  await browser.close();
  await cleanup().catch((e) => console.log('limpeza: ' + e.message));
  const { count } = await admin.from('patients').select('id', { count: 'exact', head: true }).eq('name', 'Paciente Portal E2E');
  console.log(`dados de teste restantes: ${count}`);
}
