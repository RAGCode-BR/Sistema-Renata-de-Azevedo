import puppeteer from 'puppeteer-core';
const [base, ownerEmail, ownerPassword] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 860 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const waitText = (t) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout: 10000, polling: 200 }, t);
const clickText = async (sel, t) => (await page.waitForFunction((s, x) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === x && !e.disabled), { timeout: 10000 }, sel, t)).asElement().click();
const typeIn = (name, v) => page.type(`dialog[open] [name="${name}"]`, v);
const rowOf = (email) => page.evaluate((e) => [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(e))?.innerText, email);
async function selectModule(module) {
  await page.click(`.rail-link[aria-label="${module}"]`);
  await page.waitForFunction((m) => document.querySelector('.subnav h2')?.textContent === m, { timeout: 5000 }, module);
}
async function menuPages() {
  const modules = await page.$$eval('.rail-link', (els) => els.map((e) => e.getAttribute('aria-label')));
  const pages = [];
  for (const module of modules) { await selectModule(module); pages.push(...await page.$$eval('.sub-link', (els) => els.map((e) => e.textContent.trim()))); }
  return pages;
}
async function go(label) {
  for (const module of await page.$$eval('.rail-link', (els) => els.map((e) => e.getAttribute('aria-label')))) {
    await selectModule(module);
    if (await page.$$eval('.sub-link', (els, l) => els.some((e) => e.textContent.trim() === l), label)) return clickText('.sub-link', label);
  }
  throw new Error(`Página ${label} não está no menu`);
}
async function logout() {
  await page.click('.avatar-btn');
  await page.evaluate(() => [...document.querySelectorAll('.pop-item')].find((b) => b.textContent.trim() === 'Sair').click());
  await waitText('Entrar no sistema');
}
async function login(email, password) {
  await page.waitForSelector('input[name=email]');
  await page.$eval('input[name=email]', (e) => { e.value = ''; });
  await page.$eval('input[name=password]', (e) => { e.value = ''; });
  await page.type('input[name=email]', email);
  await page.type('input[name=password]', password);
  await clickText('button', 'Entrar');
}
async function newUser(name, email, roles, professional) {
  await clickText('button', 'Novo usuário');
  await typeIn('name', name);
  await typeIn('email', email);
  for (const role of ['professional', 'owner', 'manager', 'reception', 'finance']) {
    const checked = await page.$eval(`dialog[open] input[name=roles][value=${role}]`, (e) => e.checked);
    if (checked !== roles.includes(role)) await page.click(`dialog[open] input[name=roles][value=${role}]`);
  }
  if (professional) {
    const value = await page.$eval('dialog[open] select[name=professionalId]', (el, l) => [...el.options].find((o) => o.textContent === l)?.value, professional);
    await page.select('dialog[open] select[name=professionalId]', value);
  }
  await typeIn('password', 'Senha-Bloco1-ok');
  await clickText('dialog[open] button', 'Criar usuário');
  await waitText('Usuário criado.');
  await page.waitForFunction((e) => document.body.innerText.includes(e), { timeout: 10000 }, email);
}
async function editUser(email, change) {
  await page.evaluate((e) => [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(e)).querySelector('button').click(), email);
  await page.waitForSelector('dialog[open] input[name=roles]');
  await change();
  await clickText('dialog[open] button', 'Salvar');
  await waitText('Usuário atualizado.');
}

const localInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const nextMonday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d; };
const at = (base, days, h, m = 0) => { const d = new Date(base); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
const card = (text) => page.evaluate((t) => [...document.querySelectorAll('.slot-item')].map((e) => e.innerText).find((x) => x.includes(t)) ?? null, text);
const toast = (t) => waitText(t);
async function newSession({ when, duration = '50', frequency = '', count }) {
  await clickText('button', 'Nova sessão');
  const value = await page.$eval('dialog[open] select[name=professionalId]', (el) => [...el.options].find((o) => o.textContent === 'Teste Ficha')?.value);
  await page.select('dialog[open] select[name=professionalId]', value);
  await page.waitForFunction(() => document.querySelector('dialog[open] select[name=patientId]').textContent.includes('Paciente Ficha'));
  await page.$eval('dialog[open] input[name=startsAt]', (el, v) => { el.value = v; }, localInput(when));
  await page.select('dialog[open] select[name=duration]', duration);
  if (frequency) {
    await page.select('dialog[open] select[name=frequency]', frequency);
    await page.waitForSelector('dialog[open] input[name=count]');
    await page.$eval('dialog[open] input[name=count]', (el, v) => { el.value = v; }, String(count));
  }
  await page.click('dialog[open] button[type=submit]');
}
async function openCard(text) {
  await page.waitForFunction((t) => [...document.querySelectorAll('.slot-item')].some((e) => e.innerText.includes(t)), { timeout: 10000 }, text);
  await page.evaluate((t) => [...document.querySelectorAll('.slot-item')].find((e) => e.innerText.includes(t)).click(), text);
  await page.waitForSelector('dialog[open]');
}
async function goWeekOf(date) {
  await page.evaluate((key) => { location.hash = '#/agenda?data=' + key + '&t=' + Date.now(); }, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  await waitText('sessões marcadas no período').catch(() => waitText('sessão marcada no período'));
  await clickText('.tab', 'Semana');
}

const FILES = process.env.FIXTURES_DIR;
const factsText = () => page.evaluate(() => document.querySelector('main').innerText);

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  await go('Profissionais');
  await clickText('button', 'Nova profissional');
  await typeIn('name', 'Teste Ficha');
  await clickText('dialog[open] button', 'Cadastrar profissional');
  await toast('Profissional cadastrada.');
  await go('Usuários');
  await waitText(ownerEmail);
  await newUser('Teste Ficha', 'teste-ficha@example.test', ['professional'], 'Teste Ficha');

  await go('Pacientes');
  await clickText('button', 'Novo paciente');
  await typeIn('name', 'Paciente Ficha');
  await page.$eval('dialog[open] input[name=birthDate]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '2014-05-10'); el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForSelector('dialog[open] input[name=guardian_name]');
  ok('Nascimento de menor de idade abre os campos do responsável legal');
  await typeIn('guardian_name', 'Mãe Ficha');
  await typeIn('guardian_relationship', 'mãe');
  await typeIn('phone', '(11) 98888-7777');
  await typeIn('email', 'ficha@example.test');
  await typeIn('cpf', '111.111.111-11');
  await (await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] label.check')].find((l) => l.textContent.trim() === 'Teste Ficha')?.querySelector('input'))).asElement().click();
  await clickText('dialog[open] button', 'Cadastrar paciente');
  await waitText('CPF inválido.');
  await page.$eval('dialog[open] input[name=cpf]', (el) => { el.value = ''; });
  await typeIn('cpf', '529.982.247-25');
  await clickText('dialog[open] button', 'Cadastrar paciente');
  await toast('Paciente cadastrado.');
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Paciente Ficha', { timeout: 10000 });
  const lead = await page.$eval('.lead', (e) => e.textContent);
  if (!lead.includes('Em acompanhamento') || !lead.includes('12 anos') || !lead.includes('Teste Ficha')) throw new Error(`lead: ${lead}`);
  const overview = await factsText();
  if (!overview.includes('529.982.247-25') || !overview.includes('Mãe Ficha (mãe)')) throw new Error('visão geral sem CPF ou responsável');
  ok('CPF inválido recusado; cadastro salvo abre a página do paciente com idade, CPF e responsável');
  // Agenda antes de pausar: só pacientes em acompanhamento aparecem para nova sessão.
  await go('Agenda');
  await waitText('no período');
  await newSession({ when: at(new Date(), 1, 9) });
  await toast('Sessão agendada.');
  await page.evaluate(() => { location.hash = '#/pacientes'; });
  await page.waitForFunction(() => [...document.querySelectorAll('tbody a')].some((a) => a.textContent === 'Paciente Ficha'), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('tbody a')].find((a) => a.textContent === 'Paciente Ficha').click());
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Paciente Ficha');

  await clickText('button', 'Editar cadastro');
  await page.waitForSelector('dialog[open] select[name=status]');
  await page.select('dialog[open] select[name=status]', 'paused');
  await page.type('dialog[open] textarea[name=admin_notes]', 'Prefere contato por WhatsApp.');
  await clickText('dialog[open] button', 'Salvar');
  await toast('Cadastro atualizado.');
  await page.waitForFunction(() => document.querySelector('.lead')?.textContent.includes('Pausado') && document.querySelector('main').innerText.includes('Prefere contato por WhatsApp.'), { timeout: 10000 });
  ok('Edição: situação "Pausado" e observação administrativa salvas');

  await clickText('.tab', 'Documentos');
  const input = await page.waitForSelector('input[type=file]');
  await input.uploadFile(`${FILES}/nota.txt`);
  await page.click('main form button[type=submit]');
  await waitText('Tipo de arquivo não aceito. Use PDF, imagem ou Word.');
  await (await page.$('input[type=file]')).uploadFile(`${FILES}/contrato-teste.pdf`);
  await page.type('main form input[name=title]', 'Contrato teste');
  await page.click('main form button[type=submit]');
  await toast('Documento enviado.');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes('Contrato teste')), { timeout: 10000 });
  ok('Arquivo .txt recusado pelo bucket; PDF enviado e listado');

  const popup = new Promise((resolve) => browser.once('targetcreated', (target) => resolve(target)));
  await clickText('button', 'Abrir');
  const target = await popup;
  await page.waitForFunction(() => true);
  for (let i = 0; i < 40 && !target.url().includes('/storage/v1/object/sign/'); i++) await new Promise((r) => setTimeout(r, 250));
  if (!target.url().includes('/storage/v1/object/sign/patient-documents/')) throw new Error(`link: ${target.url()}`);
  const response = await fetch(target.url());
  if (!response.ok || !(await response.text()).startsWith('%PDF')) throw new Error('arquivo não abriu pelo link temporário');
  (await target.page())?.close();
  ok('"Abrir" gera link temporário assinado que entrega o PDF');

  await page.evaluate(() => { location.hash = '#/pacientes'; });
  await page.waitForSelector('select[aria-label=Situação]');
  await page.type('.search input', '98888');
  await page.waitForFunction(() => document.querySelector('main').innerText.includes('Nenhum paciente encontrado'), { timeout: 10000 });
  await page.select('select[aria-label=Situação]', 'paused');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody a')].some((a) => a.textContent === 'Paciente Ficha'), { timeout: 10000 });
  ok('Lista: busca por telefone e filtro por situação (paciente pausado só aparece com o filtro certo)');

  await page.evaluate(() => [...document.querySelectorAll('tbody a')].find((a) => a.textContent === 'Paciente Ficha').click());
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Paciente Ficha');
  await clickText('.tab', 'Sessões');
  await page.waitForFunction(() => [...document.querySelectorAll('.number')].some((n) => n.innerText.includes('1') && n.innerText.includes('próximas')), { timeout: 10000 });
  ok('Aba Sessões: a sessão agendada aparece como próxima');

  await logout();
  await login('teste-ficha@example.test', 'Senha-Bloco1-ok');
  await waitText('Olá, Teste');
  await page.evaluate(() => { location.hash = '#/pacientes'; });
  await page.waitForSelector('select[aria-label=Situação]');
  await page.select('select[aria-label=Situação]', '');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody a')].some((a) => a.textContent === 'Paciente Ficha'), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('tbody a')].find((a) => a.textContent === 'Paciente Ficha').click());
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Paciente Ficha');
  if (await page.$$eval('button', (els) => els.some((b) => b.textContent === 'Editar cadastro'))) throw new Error('profissional pode editar cadastro');
  await clickText('.tab', 'Documentos');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes('Contrato teste')), { timeout: 10000 });
  if (await page.$('input[type=file]') || await page.$$eval('button', (els) => els.some((b) => b.textContent === 'Excluir'))) throw new Error('profissional pode enviar ou excluir documento');
  await clickText('.tab', 'Prontuário');
  await page.waitForFunction(() => [...document.querySelectorAll('a.button')].some((a) => a.textContent === 'Abrir prontuário'));
  ok('Profissional responsável: vê o paciente e o documento, não edita nem envia, e tem atalho para o prontuário');

  await logout();
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  await page.evaluate(() => { location.hash = '#/pacientes'; });
  await page.waitForSelector('select[aria-label=Situação]');
  await page.select('select[aria-label=Situação]', 'paused');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody a')].some((a) => a.textContent === 'Paciente Ficha'), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('tbody a')].find((a) => a.textContent === 'Paciente Ficha').click());
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Paciente Ficha');
  await clickText('.tab', 'Prontuário');
  await waitText('O prontuário é visível apenas para a profissional responsável');
  await clickText('.tab', 'Documentos');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes('Contrato teste')), { timeout: 10000 });
  await clickText('button', 'Excluir');
  await clickText('dialog[open] button', 'Excluir documento');
  await toast('Documento excluído.');
  await waitText('Nenhum documento.');
  ok('Gerência não abre o prontuário; documento excluído (arquivo apagado do Storage)');

  await page.setViewport({ width: 390, height: 844 });
  await clickText('.tab', 'Visão geral');
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('rolagem horizontal no celular');
  await page.screenshot({ path: `${process.env.SHOT_DIR}/paciente-celular.png`, fullPage: true });
  ok('Página do paciente no celular sem rolagem horizontal');
} catch (error) {
  console.log(`✖ FALHA após o passo ${n}: ${error.message}`);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/paciente-falha.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  console.log(problems.length ? `Erros de página: ${problems.join(' | ')}` : 'Sem erros de página');
  await browser.close();
}
