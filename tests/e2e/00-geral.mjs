import puppeteer from 'puppeteer-core';

const [base, adminEmail, adminPassword, out, projectDir, dbName] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 860 });
const problems = [];
page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) problems.push(`${m.type()}: ${m.text()} ${m.location()?.url ?? ''}`); });
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
let n = 0;
const ok = (msg) => console.log(`✔ ${++n}. ${msg}`);
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });

async function clickText(selector, text) {
  const handle = await page.waitForFunction((sel, t) => [...document.querySelectorAll(sel)].find((e) => e.textContent.trim() === t && !e.disabled),
    { timeout: 5000 }, selector, text);
  await handle.asElement().click();
}

// Menu novo: trilho de módulos + submenu de páginas.
async function menuPages() {
  const modules = await page.$$eval('.rail-link', (els) => els.map((e) => e.getAttribute('aria-label')));
  const pages = [];
  for (const module of modules) {
    await page.click(`.rail-link[aria-label="${module}"]`);
    await page.waitForFunction((m) => document.querySelector('.subnav h2')?.textContent === m, { timeout: 5000 }, module);
    pages.push(...await page.$$eval('.sub-link', (els) => els.map((e) => e.textContent.trim())));
  }
  return pages;
}
async function go(label) {
  const modules = await page.$$eval('.rail-link', (els) => els.map((e) => e.getAttribute('aria-label')));
  for (const module of modules) {
    await page.click(`.rail-link[aria-label="${module}"]`);
    await page.waitForFunction((m) => document.querySelector('.subnav h2')?.textContent === m, { timeout: 5000 }, module);
    if (await page.$$eval('.sub-link', (els, l) => els.some((e) => e.textContent.trim() === l), label)) return clickText('.sub-link', label);
  }
  throw new Error(`Página ${label} não está no menu`);
}
async function account(target, item) {
  await target.click('.avatar-btn');
  await target.waitForSelector('#conta-menu:not([hidden])');
  await target.evaluate((t) => [...document.querySelectorAll('.pop-item')].find((b) => b.textContent.trim() === t).click(), item);
}
const waitText = (text) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 5000 }, text);
const noText = async (text) => { if (await page.evaluate((t) => document.body.innerText.includes(t), text)) throw new Error(`Texto inesperado: ${text}`); };
const typeIn = (name, value) => page.type(`dialog[open] [name="${name}"]`, value);
const setValue = (selector, value) => page.$eval(selector, (el, v) => { el.value = v; }, value);
async function selectByLabel(selector, label) {
  const value = await page.$eval(selector, (el, l) => [...el.options].find((o) => o.textContent === l)?.value, label);
  if (!value) throw new Error(`Opção ${label} não encontrada`);
  await page.select(selector, value);
}
async function login(email, password) {
  await page.$eval('input[name=username]', (el) => { el.value = ''; });
  await page.$eval('input[name=password]', (el) => { el.value = ''; });
  await page.type('input[name=username]', email.split('@')[0]);
  await page.type('input[name=password]', password);
  await clickText('button', 'Entrar');
}
const localInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const tomorrowAt = (h, m) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0); return d; };

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await waitText('Entrar no sistema');
  await shot('01-login');
  ok('Tela de login carregada');

  await login(adminEmail, 'senha-errada-123');
  await waitText('Login ou senha inválidos.');
  ok('Senha errada recusada com mensagem');

  await login(adminEmail, adminPassword);
  await waitText('Olá,');
  await go('Agenda');
  await waitText('no período');
  await waitText('Cadastre uma profissional e um paciente');
  const adminNav = await menuPages();
  if (adminNav.includes('Prontuários')) throw new Error('Administração vê Prontuários');
  ok(`Administração entrou; menu: ${adminNav.join(', ')}`);

  await go('Profissionais');
  for (const [name, email] of [['Teste Renata', 'renata@example.test'], ['Teste Mariana', 'mariana@example.test']]) {
    await clickText('button', 'Nova profissional');
    await typeIn('name', name);
    await typeIn('email', email);
    await clickText('dialog[open] button', 'Cadastrar profissional');
    await page.waitForFunction((t) => [...document.querySelectorAll('td')].some((td) => td.textContent === t), { timeout: 5000 }, name);
  }
  ok('Duas profissionais cadastradas pela janela');

  await go('Usuários');
  await clickText('button', 'Novo usuário');
  await typeIn('name', 'Teste Renata');
  await typeIn('email', 'renata@example.test');
  await typeIn('username', 'renata');
  await selectByLabel('dialog[open] select[name=professionalId]', 'Teste Renata');
  await typeIn('password', 'Senha-Renata-123!');
  await clickText('dialog[open] button', 'Criar usuário');
  await waitText('Usuário criado.');
  await clickText('button', 'Novo usuário');
  const options = await page.$$eval('dialog[open] select[name=professionalId] option', (els) => els.map((e) => e.textContent));
  if (options.includes('Teste Renata')) throw new Error('Profissional com conta continua disponível');
  await page.click('dialog[open] input[name=roles][value=professional]');
  await page.click('dialog[open] input[name=roles][value=owner]');
  if (await page.$('dialog[open] select[name=professionalId]')) throw new Error('Campo de profissional visível para administração');
  await clickText('dialog[open] button', 'Cancelar');
  ok('Conta da profissional criada; ela sai da lista de disponíveis; campo some para administração');

  await go('Pacientes');
  await clickText('button', 'Novo paciente');
  await typeIn('name', 'Paciente Exemplo');
  await typeIn('phone', '(11) 99999-0000');
  await page.$eval('dialog[open] input[name=birthDate]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '1990-05-02'); el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('dialog[open] button', 'Cadastrar paciente');
  await waitText('Selecione ao menos uma profissional responsável.');
  ok('Paciente sem profissional recusado no formulário');
  const renataBox = await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] label.check')]
    .find((l) => l.textContent.trim() === 'Teste Renata')?.querySelector('input'));
  await renataBox.asElement().click();
  await clickText('dialog[open] button', 'Cadastrar paciente');
  await waitText('Paciente cadastrado.');
  await waitText('02/05/1990');
  await go('Pacientes');
  await page.waitForSelector('.search input');
  await page.type('.search input', 'xyz');
  await waitText('Nenhum paciente encontrado');
  await page.$eval('.search input', (el) => { el.value = ''; });
  await page.type('.search input', 'exem');
  await waitText('Paciente Exemplo');
  await shot('02-pacientes');
  ok('Paciente cadastrado, data de nascimento correta, busca funciona');

  await go('Agenda');
  await clickText('button', 'Nova sessão');
  await selectByLabel('dialog[open] select[name=professionalId]', 'Teste Mariana');
  await page.waitForFunction(() => document.querySelector('dialog[open] select[name=patientId]').textContent.includes('Nenhum paciente vinculado'));
  await selectByLabel('dialog[open] select[name=professionalId]', 'Teste Renata');
  await page.waitForFunction(() => document.querySelector('dialog[open] select[name=patientId]').textContent.includes('Paciente Exemplo'));
  ok('Pacientes filtrados pela profissional escolhida');
  await setValue('dialog[open] input[name=startsAt]', localInput(tomorrowAt(10, 0)));
  await clickText('dialog[open] button', 'Agendar');
  await waitText('Sessão agendada.');
  // Abre a semana de amanhã (num domingo, amanhã já é a semana seguinte).
  await page.evaluate((d) => { location.hash = '#/agenda?data=' + d; }, (() => { const d = tomorrowAt(10, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })());
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-item')].some((e) => e.innerText.includes('Paciente Exemplo') && e.innerText.includes('10:00')), { timeout: 10000 });
  await waitText('1 sessão marcada no período');
  await shot('03-agenda');
  ok('Sessão de 50 minutos agendada e listada no dia certo');

  await clickText('button', 'Nova sessão');
  await selectByLabel('dialog[open] select[name=professionalId]', 'Teste Renata');
  await setValue('dialog[open] input[name=startsAt]', localInput(tomorrowAt(10, 20)));
  await clickText('dialog[open] button', 'Agendar');
  await waitText('Já existe sessão nesse horário para esta profissional.');
  await shot('04-conflito');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  ok('Conflito de horário mostrado na janela; Esc fecha');

  await go('Google Agenda');
  await waitText('Nenhuma profissional conectou o Google ainda.');
  ok('Tela Google Agenda');

  await account(page, 'Trocar senha');
  await page.waitForSelector('dialog[open] input[name=currentPassword]');
  await clickText('dialog[open] button', 'Cancelar');
  await account(page, 'Sair');
  await waitText('Entrar no sistema');
  ok('Diálogo de senha abre; saída volta ao login');

  await login('renata@example.test', 'Senha-Renata-123!');
  await waitText('Olá,');
  await go('Agenda');
  await page.evaluate((d) => { location.hash = '#/agenda?data=' + d; }, (() => { const d = tomorrowAt(10, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })());
  await waitText('1 sessão marcada no período');
  const proNav = await menuPages();
  if (proNav.includes('Usuários') || proNav.includes('Profissionais')) throw new Error('Profissional vê telas da administração');
  await noText('Nova sessão');
  ok(`Profissional entrou; menu: ${proNav.join(', ')}`);

  await page.goto(`${base}/#/usuarios`, { waitUntil: 'networkidle0' });
  await waitText('Olá,');
  ok('Endereço de tela da administração cai na Agenda para a profissional');

  await go('Prontuários');
  await page.waitForFunction(() => document.querySelector('main select')?.textContent.includes('Paciente Exemplo'));
  await selectByLabel('main select', 'Paciente Exemplo');
  await page.waitForSelector('textarea[name=body]');
  await waitText('Nenhuma evolução registrada.');
  await page.type('textarea[name=body]', 'Primeira sessão.\nPaciente relata melhora do sono.');
  await clickText('button', 'Finalizar evolução');
  await clickText('dialog[open] button', 'Finalizar');
  await waitText('Evolução finalizada.');
  await waitText('Paciente relata melhora do sono.');
  const cleared = await page.$eval('textarea[name=body]', (el) => el.value === '');
  if (!cleared) throw new Error('Campo da evolução não foi limpo');
  await shot('05-prontuarios');
  ok('Evolução salva, exibida no histórico e campo limpo');

  // No celular o menu lateral vira a barra inferior: a navegação aqui é pelo endereço.
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate((d) => { location.hash = '#/agenda?data=' + d; }, (() => { const d = tomorrowAt(10, 0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })());
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-item')].some((e) => e.innerText.includes('Paciente Exemplo') && e.innerText.includes('10:00')), { timeout: 10000 });
  await shot('06-celular-agenda');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw new Error('Página rola na horizontal no celular');
  ok('Layout de celular sem rolagem horizontal');

  const other = await browser.newPage();
  await other.goto(base, { waitUntil: 'networkidle0' });
  await other.waitForSelector('.avatar-btn');
  await account(other, 'Sair');
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout: 20000, polling: 500 }, 'Sua sessão terminou. Entre novamente.');
  await other.close();
  ok('Sair em outra aba leva esta de volta ao login com aviso');
} catch (error) {
  console.log(`✖ FALHA após o passo ${n}: ${error.message}`);
  await shot('falha').catch(() => {});
  process.exitCode = 1;
} finally {
  console.log(problems.length ? `Console do navegador:\n${problems.join('\n')}` : 'Console do navegador: sem erros nem avisos');
  await browser.close();
}
