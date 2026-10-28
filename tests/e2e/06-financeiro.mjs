import puppeteer from 'puppeteer-core';
const [base, ownerEmail, ownerPassword] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 860 });
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const waitText = (t) => page.waitForFunction((x) => document.body.innerText.replace(/\u00a0/g, ' ').includes(x), { timeout: 10000, polling: 200 }, t);
const clickText = async (sel, t) => (await page.waitForFunction((s, x) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim() === x && !e.disabled), { timeout: 10000 }, sel, t)).asElement().click();
const typeIn = (name, v) => page.type(`dialog[open] [name="${name}"]`, v);
const rowOf = (email) => page.evaluate((e) => [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(e))?.innerText.replace(/\u00a0/g, ' '), email);
async function selectModule(module) {
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 });
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
  await page.waitForSelector('input[name=username]');
  await page.$eval('input[name=username]', (e) => { e.value = ''; });
  await page.$eval('input[name=password]', (e) => { e.value = ''; });
  await page.type('input[name=username]', email.split('@')[0]);
  await page.type('input[name=password]', password);
  await clickText('button', 'Entrar');
}
async function newUser(name, email, roles, professional) {
  await clickText('button', 'Novo usuário');
  await typeIn('name', name);
  await typeIn('email', email);
  await typeIn('username', email.split('@')[0]);
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
  await page.waitForFunction((e) => document.body.innerText.replace(/\u00a0/g, ' ').includes(e), { timeout: 10000 }, email);
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
const card = (text) => page.evaluate((t) => [...document.querySelectorAll('.slot-item')].map((e) => e.innerText.replace(/\u00a0/g, ' ')).find((x) => x.includes(t)) ?? null, text);
const toast = (t) => waitText(t);
async function newSession({ when, duration = '50', frequency = '', count }) {
  await clickText('button', 'Nova sessão');
  const value = await page.$eval('dialog[open] select[name=professionalId]', (el, p) => [...el.options].find((o) => o.textContent === p)?.value, PROF);
  await page.select('dialog[open] select[name=professionalId]', value);
  await page.waitForFunction((p) => document.querySelector('dialog[open] select[name=patientId]').textContent.includes(p), {}, PATIENT);
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
  await page.waitForFunction((t) => [...document.querySelectorAll('.slot-item')].some((e) => e.innerText.replace(/\u00a0/g, ' ').includes(t)), { timeout: 10000 }, text);
  await page.evaluate((t) => [...document.querySelectorAll('.slot-item')].find((e) => e.innerText.replace(/\u00a0/g, ' ').includes(t)).click(), text);
  await page.waitForSelector('dialog[open]');
}
async function goWeekOf(date) {
  await page.evaluate((key) => { location.hash = '#/agenda?data=' + key + '&t=' + Date.now(); }, `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
  await waitText('sessões marcadas no período').catch(() => waitText('sessão marcada no período'));
  await clickText('.tab', 'Semana');
}

const PROF = 'Teste Financeiro';
const PATIENT = 'Paciente Financeiro';
const PRO_EMAIL = 'teste-financeiro@example.test';
const pad = (n) => String(n).padStart(2, '0');
const today = new Date();
const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
const prevMonthDay = `${prevMonth.getFullYear()}-${pad(prevMonth.getMonth() + 1)}-05`;
const main = () => page.evaluate(() => document.querySelector('main').innerText.replace(/\u00a0/g, ' '));
const rowWith = (...parts) => page.evaluate((ps) => [...document.querySelectorAll('main tbody tr')].map((tr) => tr.innerText.replace(/\u00a0/g, ' ')).find((t) => ps.every((p) => t.includes(p))) ?? null, parts);
const waitRow = (...parts) => page.waitForFunction((ps) => [...document.querySelectorAll('main tbody tr')].some((tr) => ps.every((p) => tr.innerText.replace(/\u00a0/g, ' ').includes(p))), { timeout: 10000, polling: 200 }, parts);
const waitNoRow = (...parts) => page.waitForFunction((ps) => document.querySelector('main tbody') !== null || document.querySelector('.empty-state'), { timeout: 10000 }, parts)
  .then(() => page.waitForFunction((ps) => ![...document.querySelectorAll('main tbody tr')].some((tr) => ps.every((p) => tr.innerText.replace(/\u00a0/g, ' ').includes(p))), { timeout: 10000, polling: 200 }, parts));
const clickInRow = async (label, ...parts) => {
  await waitRow(...parts);
  await page.evaluate((l, ps) => [...[...document.querySelectorAll('main tbody tr')].find((tr) => ps.every((p) => tr.innerText.replace(/\u00a0/g, ' ').includes(p))).querySelectorAll('button')].find((b) => b.textContent.trim() === l).click(), label, parts);
  await page.waitForSelector('dialog[open]');
};
const selectByText = async (name, label) => {
  const value = await page.$eval(`dialog[open] select[name=${name}]`, (el, l) => [...el.options].find((o) => o.textContent === l)?.value, label);
  if (value === undefined) throw new Error(`Opção ${label} não encontrada em ${name}`);
  await page.select(`dialog[open] select[name=${name}]`, value);
};
const setValue = (selector, value) => page.$eval(selector, (el, v) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, value);
const clearType = async (name, value) => { await page.$eval(`dialog[open] [name="${name}"]`, (el) => { el.value = ''; }); await typeIn(name, value); };

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);

  // Preparação: profissional, conta dela, paciente.
  await go('Profissionais');
  await clickText('button', 'Nova profissional');
  await typeIn('name', PROF);
  // O repasse por atendimento só é calculado com a comissão ligada (Proprietária gerencia o financeiro).
  await page.$eval('dialog[open] input[name=commission_sessions]', (input) => input.click());
  await typeIn('email', 'teste-financeiro-prof@example.test');
  await clickText('dialog[open] button', 'Cadastrar profissional');
  await toast('Profissional cadastrada.');
  await go('Usuários');
  await waitText(ownerEmail);
  await newUser(PROF, PRO_EMAIL, ['professional'], PROF);
  await go('Pacientes');
  await clickText('button', 'Novo paciente');
  await typeIn('name', PATIENT);
  await (await page.waitForFunction((p) => [...document.querySelectorAll('dialog[open] label.check')].find((l) => l.textContent.trim() === p)?.querySelector('input'), {}, PROF)).asElement().click();
  await clickText('dialog[open] button', 'Cadastrar paciente');
  await toast('Paciente cadastrado.');

  const pages = await menuPages();
  for (const p of ['Visão geral', 'Cobranças', 'Despesas', 'Repasses', 'Preços']) if (!pages.includes(p)) throw new Error(`Menu sem ${p}: ${pages}`);
  ok('Proprietário(a): módulo Financeiro com Visão geral, Cobranças, Despesas, Repasses e Preços');

  await go('Preços');
  await clickText('button', 'Novo preço');
  await selectByText('professional', PROF);
  await typeIn('amount', '300');
  await clickText('dialog[open] button', 'Salvar');
  await toast('Preço salvo.');
  await waitRow(PROF, 'Qualquer tipo', 'R$ 300,00');
  ok('Preços: R$ 300,00 para a profissional (qualquer tipo de sessão)');

  await go('Agenda');
  await waitText('no período');
  await newSession({ when: at(new Date(), -1, 10) });
  await toast('Sessão agendada.');
  await goWeekOf(at(new Date(), -1, 10));
  await openCard(PATIENT);
  await clickText('dialog[open] button', 'Realizada');
  await toast('Presença registrada.');

  await go('Cobranças');
  await waitRow(PATIENT, 'Sessão de', 'R$ 300,00', 'Vencida');
  ok('Sessão marcada como realizada gerou cobrança de R$ 300,00 (vencida: sessão de ontem)');

  await clickText('button', 'Registrar pagamento');
  await selectByText('patientId', PATIENT);
  await page.waitForFunction(() => document.querySelector('dialog[open] .charge-picks input[type=checkbox]'), { timeout: 10000 });
  await page.click('dialog[open] .charge-picks input[type=checkbox]');
  await typeIn('amount', '150');
  await page.$eval('dialog[open] input[name=receivedAt]', (el, v) => { el.value = v; }, prevMonthDay);
  await clickText('dialog[open] button', 'Registrar pagamento');
  await toast('Pagamento registrado.');
  await waitRow(PATIENT, 'R$ 300,00', 'R$ 150,00', 'Vencida');
  ok('Pagamento parcial de R$ 150,00 (recebido no mês passado): cobrança com R$ 150,00 em aberto');

  await clickInRow('Receber', PATIENT, 'Sessão de');
  await page.waitForFunction(() => document.querySelector('dialog[open] .charge-picks input[type=checkbox]')?.checked, { timeout: 10000 });
  await typeIn('amount', '200');
  await page.waitForFunction(() => document.querySelector('dialog[open]').innerText.replace(/\u00a0/g, ' ').includes('Sobram R$ 50,00 como crédito'), { timeout: 5000 });
  await clickText('dialog[open] button', 'Registrar pagamento');
  await toast('R$ 50,00 ficaram como crédito');
  await waitNoRow(PATIENT, 'Sessão de');
  ok('Pagamento de R$ 200,00 quitou a sessão e deixou R$ 50,00 de crédito; cobrança saiu de "Em aberto"');

  await clickText('button', 'Nova cobrança');
  await selectByText('patientId', PATIENT);
  await selectByText('professionalId', PROF);
  await typeIn('description', 'Relatório psicológico');
  await typeIn('amount', '80,00');
  await clickText('dialog[open] button', 'Criar cobrança');
  await toast('Cobrança criada.');
  await waitRow(PATIENT, 'Relatório psicológico', 'R$ 80,00', 'R$ 50,00', 'R$ 30,00');
  ok('Cobrança avulsa de R$ 80,00: crédito de R$ 50,00 abatido sozinho, R$ 30,00 em aberto');

  await page.evaluate(() => [...document.querySelectorAll('main tbody a')].find((a) => a.textContent === 'Paciente Financeiro').click());
  await page.waitForFunction(() => document.querySelector('.tab.on')?.textContent === 'Financeiro', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('main .numbers')?.innerText.replace(/\u00a0/g, ' ').includes('crédito disponível'), { timeout: 10000 });
  const facts = await page.$eval('main .numbers', (el) => el.innerText.replace(/\u00a0/g, ' '));
  if (!facts.includes('R$ 30,00') || !/R\$ 0,00\s*crédito disponível/.test(facts)) throw new Error('Aba Financeiro: ' + facts);
  await waitRow('Pix'.toUpperCase(), 'R$ 200,00');
  ok('Página do paciente, aba Financeiro: R$ 30,00 em aberto, crédito zerado, 2 pagamentos listados');

  await clickText('.number .link-btn', 'Alterar');
  await typeIn('amount', '280');
  await clickText('dialog[open] button', 'Salvar');
  await toast('Valor combinado salvo.');
  await page.waitForFunction(() => document.querySelector('main .numbers').innerText.replace(/\u00a0/g, ' ').includes('R$ 280,00'), { timeout: 10000 });
  ok('Valor combinado do paciente: R$ 280,00');

  await go('Cobranças');
  await clickText('.tab', 'Pagamentos');
  await clickInRow('Estornar', PATIENT, 'R$ 200,00');
  await typeIn('reason', 'Teste de estorno');
  await clickText('dialog[open] button', 'Estornar');
  await toast('Pagamento estornado.');
  await waitRow(PATIENT, 'R$ 200,00', 'Estornado');
  await clickText('.tab', 'Em aberto');
  await waitRow(PATIENT, 'Sessão de', 'R$ 150,00');
  await waitRow(PATIENT, 'Relatório psicológico', 'R$ 80,00');
  ok('Estorno de R$ 200,00: sessão volta a R$ 150,00 em aberto e o relatório a R$ 80,00');

  await go('Repasses');
  await waitRow(PROF, 'R$ 150,00', 'não definido');
  await clickInRow('Percentual', PROF);
  await typeIn('percent', '60');
  await clickText('dialog[open] button', 'Salvar');
  await toast('Percentual salvo.');
  await waitRow(PROF, '60%', 'R$ 90,00', 'A fechar');
  await clickInRow('Fechar e pagar', PROF);
  await clickText('dialog[open] button', 'Fechar e registrar pagamento');
  await toast('Repasse fechado.');
  await waitRow(PROF, 'R$ 90,00', 'Pago em');
  ok('Repasse do mês passado: 60% de R$ 150,00 = R$ 90,00, fechado e pago');

  await go('Despesas');
  await clickText('button', 'Nova despesa');
  await typeIn('description', 'Aluguel teste E2E');
  await typeIn('amount', '1.000,00');
  await selectByText('category', 'Aluguel');
  await selectByText('center', 'Administrativo');
  await page.click('dialog[open] label.check input[type=checkbox]');
  await page.waitForSelector('dialog[open] input[name=paidAt]');
  await clickText('dialog[open] button', 'Lançar despesa');
  await toast('Despesa lançada.');
  await waitRow('Aluguel teste E2E', 'Aluguel', 'Administrativo', 'R$ 1.000,00', 'Paga em');
  ok('Despesa de R$ 1.000,00 lançada como paga');

  await go('Visão geral');
  await page.waitForFunction(() => document.querySelector('.finance-numbers')?.innerText.replace(/\u00a0/g, ' ').includes('despesas pagas'), { timeout: 10000 });
  const kpis = await page.$eval('.finance-numbers', (el) => el.innerText.replace(/\u00a0/g, ' '));
  if (!kpis.includes('R$ 1.000,00') || !kpis.includes('vs mês anterior')) throw new Error('KPIs: ' + kpis);
  const bars = await page.$$eval('.chart-box path', (els) => els.length);
  if (bars < 2) throw new Error('Gráfico sem barras: ' + bars);
  const hits = await page.$$('.chart-box .hit');
  await hits[today.getMonth()].hover();
  await page.waitForSelector('.chart-tip');
  const tip = await page.$eval('.chart-tip', (el) => el.innerText.replace(/\u00a0/g, ' '));
  if (!tip.includes('Saídas') || !tip.includes('R$ 1.090,00')) throw new Error('Dica: ' + tip);
  await page.screenshot({ path: process.env.SHOT_DIR + '/financeiro-visao-geral.png', fullPage: true });
  await clickText('.link-btn', 'Ver tabela');
  await page.waitForFunction(() => document.querySelector('.cash-chart table')?.innerText.replace(/\u00a0/g, ' ').includes('Despesas pagas'));
  await waitRow('Aluguel', 'R$ 1.000,00', '100%');
  ok(`Visão geral: indicadores com comparação, gráfico (${bars} barras) com dica ao passar o mouse, tabela e despesas por categoria`);

  await go('Início');
  await page.waitForFunction(() => document.querySelector('.todo')?.innerText.replace(/\u00a0/g, ' ').includes('cobrança'), { timeout: 10000 });
  ok('Painel: pendência de cobranças vencidas');

  await logout();
  await login(PRO_EMAIL, 'Senha-Bloco1-ok');
  await waitText('Olá, Teste');
  const proPages = await menuPages();
  if (!proPages.includes('Cobranças') || !proPages.includes('Meu repasse') || proPages.some((p) => ['Visão geral', 'Despesas', 'Preços', 'Repasses'].includes(p))) throw new Error('Menu profissional: ' + proPages);
  await go('Cobranças');
  await waitRow(PATIENT, 'Sessão de', 'R$ 150,00');
  const proText = await main();
  if (proText.includes('Registrar pagamento') || proText.includes('Receber') || proText.includes('a receber')) throw new Error('Profissional viu ações de caixa');
  await go('Meu repasse');
  await waitRow(PROF, 'R$ 90,00');
  const rows = await page.$$eval('main tbody tr', (els) => els.length);
  if (rows !== 1) throw new Error('Profissional viu repasses de outras: ' + rows);
  ok('Profissional: só as cobranças das próprias sessões (sem ações) e o próprio repasse');

  console.log(problems.length ? 'Erros de página: ' + problems.join(' | ') : 'Sem erros de JavaScript na página.');
} catch (error) {
  console.log('✘ Falhou:', error.message);
  console.log('  em ' + (error.stack ?? '').split('\n').filter((l) => l.includes('/e2e/')).map((l) => l.trim().replace(/^.*\/e2e\//, '')).join(' ← '));
  await page.screenshot({ path: process.env.SHOT_DIR + '/bloco6-falha.png', fullPage: true }).catch(() => {});
  console.log(problems.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
