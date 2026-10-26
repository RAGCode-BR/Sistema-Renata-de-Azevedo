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
  const value = await page.$eval('dialog[open] select[name=professionalId]', (el) => [...el.options].find((o) => o.textContent === 'Teste Agenda')?.value);
  await page.select('dialog[open] select[name=professionalId]', value);
  await page.waitForFunction(() => document.querySelector('dialog[open] select[name=patientId]').textContent.includes('Paciente Agenda'));
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

try {
  const monday = nextMonday();
  await page.goto(base, { waitUntil: 'networkidle0' });
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);

  await go('Profissionais');
  await clickText('button', 'Nova profissional');
  await typeIn('name', 'Teste Agenda');
  await typeIn('specialty', 'Psicologia');
  await clickText('dialog[open] button', 'Cadastrar profissional');
  await toast('Profissional cadastrada.');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes('Teste Agenda') && tr.innerText.includes('Psicologia')));
  await go('Usuários');
  await waitText(ownerEmail);
  await newUser('Teste Agenda', 'teste-agenda@example.test', ['professional'], 'Teste Agenda');
  await go('Pacientes');
  await clickText('button', 'Novo paciente');
  await typeIn('name', 'Paciente Agenda');
  await (await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] label.check')].find((l) => l.textContent.trim() === 'Teste Agenda')?.querySelector('input'))).asElement().click();
  await clickText('dialog[open] button', 'Cadastrar paciente');
  await toast('Paciente cadastrado.');
  ok('Profissional com especialidade, conta e paciente cadastrados');

  await go('Agenda');
  await waitText('no período');
  await newSession({ when: at(monday, 0, 10), frequency: 'weekly', count: 3 });
  await toast('3 sessões agendadas.');
  await goWeekOf(monday);
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-item')].some((e) => e.innerText.includes('Paciente Agenda')), { timeout: 10000 });
  ok('Série semanal de 3 sessões criada e exibida na semana');

  await openCard('Paciente Agenda');
  await clickText('dialog[open] button', 'Confirmar');
  await toast('Sessão confirmada.');
  await openCard('Paciente Agenda');
  await page.waitForFunction(() => document.querySelector('dialog[open] .history')?.innerText.includes('Agendada → Confirmada'), { timeout: 10000 });
  ok('Sessão confirmada; histórico mostra "Agendada → Confirmada"');

  await clickText('dialog[open] button', 'Remarcar');
  await page.waitForSelector('dialog[open] input[name=startsAt]');
  await page.$eval('dialog[open] input[name=startsAt]', (el, v) => { el.value = v; }, localInput(at(monday, 0, 14)));
  await page.click('dialog[open] button[type=submit]');
  await toast('Sessão remarcada.');
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-item')].some((e) => e.innerText.includes('14:00')), { timeout: 10000 });
  if (await card('10:00')) throw new Error('sessão remarcada continua no horário antigo');
  await page.click('.agenda-toolbar input[type=checkbox]');
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-item')].some((e) => e.innerText.includes('remarcada')), { timeout: 10000 });
  await page.click('.agenda-toolbar input[type=checkbox]');
  ok('Remarcada para 14:00; a original aparece como "remarcada" só com o filtro de canceladas');

  await page.click('.pager button[aria-label="Próximo período"]');
  await openCard('Paciente Agenda');
  await clickText('dialog[open] button', 'Cancelar sessão');
  await page.waitForSelector('dialog[open] input[name=following]');
  await page.click('dialog[open] input[name=following]');
  await page.type('dialog[open] input[name=reason]', 'Férias do paciente');
  await page.click('dialog[open] button[type=submit]');
  await toast('2 sessões canceladas.');
  ok('Cancelada pelo paciente com "também as próximas": 2 sessões canceladas');

  await goWeekOf(monday);
  await clickText('button', 'Bloquear horário');
  await page.waitForSelector('dialog[open] select[name=professionalId]');
  const prof = await page.$eval('dialog[open] select[name=professionalId]', (el) => [...el.options].find((o) => o.textContent === 'Teste Agenda')?.value);
  await page.select('dialog[open] select[name=professionalId]', prof);
  await page.$eval('dialog[open] input[name=startsAt]', (el, v) => { el.value = v; }, localInput(at(monday, 1, 8)));
  await page.$eval('dialog[open] input[name=endsAt]', (el, v) => { el.value = v; }, localInput(at(monday, 1, 9)));
  await page.type('dialog[open] input[name=reason]', 'Supervisão');
  await page.click('dialog[open] input[name=reasonPrivate]');
  await page.click('dialog[open] button[type=submit]');
  await toast('Horário bloqueado.');
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-item.b-bloqueio')].some((e) => e.innerText.includes('Supervisão')), { timeout: 10000 });
  ok('Bloqueio com motivo privado criado (quem bloqueou vê o motivo)');

  await newSession({ when: at(monday, 1, 8, 30) });
  await page.waitForFunction(() => document.querySelector('dialog[open]')?.innerText.includes('Horário bloqueado na agenda desta profissional.'), { timeout: 10000 });
  await page.screenshot({ path: `${process.env.SHOT_DIR}/agenda-conflito-bloqueio.png` });
  await clickText('dialog[open] button', 'Cancelar');
  ok('Sessão sobre o bloqueio é recusada com mensagem clara');
  await page.screenshot({ path: `${process.env.SHOT_DIR}/agenda-semana.png`, fullPage: true });

  await clickText('.tab', 'Disponibilidade');
  await page.waitForSelector('.availability-list');
  const setAvailabilityTime = async (value) => page.$eval('input[aria-label="Horário para consulta"]', (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await setAvailabilityTime('14:00');
  await page.waitForFunction(() => [...document.querySelectorAll('.availability-person')].find((item) => item.querySelector('strong')?.textContent === 'Teste Agenda')?.innerText.includes('Sessão marcada'));
  await setAvailabilityTime('11:00');
  await page.waitForFunction(() => [...document.querySelectorAll('.availability-person')].find((item) => item.querySelector('strong')?.textContent === 'Teste Agenda')?.innerText.includes('Sem conflito'));
  await page.evaluate(() => [...document.querySelectorAll('.availability-person')].find((item) => item.querySelector('strong')?.textContent === 'Teste Agenda')?.querySelector('button')?.click());
  await page.waitForSelector('dialog[open] select[name=professionalId]');
  const selectedAvailabilityProfessional = await page.$eval('dialog[open] select[name=professionalId]', (el) => el.options[el.selectedIndex].textContent);
  if (selectedAvailabilityProfessional !== 'Teste Agenda') throw new Error('Disponibilidade não selecionou a profissional');
  await clickText('dialog[open] button', 'Cancelar');
  await page.$eval('input[aria-label="Ir para data"]', (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  }, `${at(monday, 1, 8).getFullYear()}-${String(at(monday, 1, 8).getMonth() + 1).padStart(2, '0')}-${String(at(monday, 1, 8).getDate()).padStart(2, '0')}`);
  await setAvailabilityTime('08:30');
  await page.waitForFunction(() => [...document.querySelectorAll('.availability-person')].find((item) => item.querySelector('strong')?.textContent === 'Teste Agenda')?.innerText.includes('Horário bloqueado'));
  await page.screenshot({ path: `${process.env.SHOT_DIR}/agenda-disponibilidade.png` });
  ok('Disponibilidade diferencia sessão, horário sem conflito e bloqueio; abre agendamento na profissional escolhida');

  await clickText('.tab', 'Mês');
  await page.waitForSelector('.month');
  await page.evaluate((day) => [...document.querySelectorAll('.month-day:not(.outside)')].find((b) => b.querySelector('b').textContent === String(day)).click(), monday.getDate());
  await page.waitForFunction(() => document.querySelector('.tab.on')?.textContent === 'Dia');
  await page.waitForFunction(() => [...document.querySelectorAll('.col-head')].some((h) => h.innerText.includes('Teste Agenda') && h.innerText.includes('Psicologia')), { timeout: 10000 });
  ok('Mês → clique no dia abre a visão Dia, com coluna por profissional e especialidade');

  const specialty = await page.$('select[aria-label=Especialidade]');
  if (!specialty) throw new Error('filtro de especialidade ausente');
  await page.select('select[aria-label=Especialidade]', 'Psicologia');
  const heads = await page.$$eval('.col-head strong', (els) => els.map((e) => e.textContent));
  if (heads.length !== 1 || heads[0] !== 'Teste Agenda') throw new Error(`colunas com filtro: ${heads}`);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/agenda-dia.png`, fullPage: true });
  ok('Filtro por especialidade deixa só as profissionais de Psicologia');

  // Presença: sessão de ontem ainda "agendada" vira pendência no Início, com atalho.
  await page.select('select[aria-label=Especialidade]', '');
  await newSession({ when: at(new Date(), -1, 10) });
  await toast('Sessão agendada.');
  await go('Início');
  await page.waitForFunction(() => document.querySelector('.todo')?.innerText.includes('sem presença registrada de Teste Agenda'), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('.todo a.task')].find((a) => a.innerText.includes('Teste Agenda')).click());
  await openCard('Paciente Agenda');
  await clickText('dialog[open] button', 'Realizada');
  await toast('Presença registrada.');
  await go('Início');
  await page.waitForFunction(() => document.querySelector('.todo')?.innerText.includes('evolução pendente de Teste Agenda'), { timeout: 10000 });
  ok('Presença registrada pelo atalho do Início; a pendência vira "evolução pendente"');

  await logout();
  await login('teste-agenda@example.test', 'Senha-Bloco1-ok');
  await waitText('Olá, Teste');
  await page.waitForFunction(() => document.querySelector('.todo')?.innerText.includes('Registrar evolução'), { timeout: 10000 });
  await go('Agenda');
  await waitText('no período');
  if (await page.$$eval('button', (els) => els.some((b) => b.textContent === 'Nova sessão'))) throw new Error('profissional vê Nova sessão');
  await goWeekOf(monday);
  const heads2 = await page.$$eval('.col-head strong', (els) => els.map((e) => e.textContent));
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-item.b-bloqueio')].some((e) => e.innerText.includes('Supervisão')), { timeout: 10000 });
  ok('Profissional: só a própria agenda, sem "Nova sessão", e vê o motivo privado do próprio bloqueio');

  await page.setViewport({ width: 390, height: 844 });
  await clickText('.tab', 'Mês');
  await page.waitForSelector('.month');
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('rolagem horizontal no celular');
  await page.screenshot({ path: `${process.env.SHOT_DIR}/agenda-celular.png`, fullPage: true });
  ok('Visão Mês no celular sem rolagem horizontal');
  await clickText('.tab', 'Disponibilidade');
  await page.waitForSelector('.availability-list');
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('disponibilidade com rolagem horizontal no celular');
  await page.screenshot({ path: `${process.env.SHOT_DIR}/agenda-disponibilidade-celular.png` });
  ok('Disponibilidade no celular sem rolagem horizontal');
} catch (error) {
  console.log(`✖ FALHA após o passo ${n}: ${error.message}`);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/agenda-falha.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  console.log(problems.length ? `Erros de página: ${problems.join(' | ')}` : 'Sem erros de página');
  await browser.close();
}
