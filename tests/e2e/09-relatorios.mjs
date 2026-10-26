import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
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
const toast = (t) => waitText(t);
const PROF = 'Teste Relatório Prof';
const MANAGER_EMAIL = 'teste-relatorios@example.test';
const DOWNLOADS = process.env.SHOT_DIR + '/downloads';
const mainText = () => page.evaluate(() => document.querySelector('main').innerText.replace(/ /g, ' '));
const waitMain = (...parts) => page.waitForFunction((ps) => { const t = (document.querySelector('main')?.innerText ?? '').replace(/ /g, ' '); return ps.every((p) => t.includes(p)); }, { timeout: 15000, polling: 250 }, parts);
const numberOf = (label) => page.evaluate((l) => [...document.querySelectorAll('main .number')].find((n) => n.innerText.includes(l))?.querySelector('strong')?.innerText.replace(/ /g, ' '), label);
const panelRow = (panel, text) => page.evaluate((p, t) => {
  const section = [...document.querySelectorAll('main .panel')].find((s) => s.querySelector('h2')?.textContent.startsWith(p));
  return [...(section?.querySelectorAll('tbody tr, tfoot tr') ?? [])].map((tr) => tr.innerText.replace(/ /g, ' ')).find((x) => x.includes(t)) ?? null;
}, panel, text);
const selectPreset = (label) => page.evaluate((l) => {
  const s = [...document.querySelectorAll('main select')].find((x) => [...x.options].some((o) => o.textContent === l));
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(s, [...s.options].find((o) => o.textContent === l).value); s.dispatchEvent(new Event('change', { bubbles: true }));
}, label);
async function exportCsv(panel, prefix) {
  fs.rmSync(DOWNLOADS, { recursive: true, force: true }); fs.mkdirSync(DOWNLOADS, { recursive: true });
  await page.evaluate((p) => [...document.querySelectorAll('main .panel')].find((s) => s.querySelector('h2')?.textContent.startsWith(p))
    .querySelector('.panel-head button').click(), panel);
  for (let i = 0; i < 40; i++) {
    const file = fs.readdirSync(DOWNLOADS).find((f) => f.startsWith(prefix) && f.endsWith('.csv'));
    if (file) return fs.readFileSync(`${DOWNLOADS}/${file}`, 'utf8');
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('CSV não baixado: ' + prefix);
}

try {
  const cdp = await page.target().createCDPSession();
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await page.goto(base, { waitUntil: 'networkidle0' });
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  const pages = await menuPages();
  for (const p of ['Operacional', 'Financeiro', 'Comercial', 'Comparativo anual']) if (!pages.includes(p)) throw new Error('Menu sem ' + p);
  ok('Proprietário(a): módulo Relatórios com Operacional, Financeiro, Comercial e Comparativo anual');

  await go('Operacional');
  await waitMain('sessões realizadas');
  await selectPreset('Mês passado');
  await page.waitForFunction(() => [...document.querySelectorAll('main .number')].some((n) => n.innerText.includes('sessões realizadas') && n.querySelector('strong').innerText === '2'), { timeout: 15000 });
  const missRate = await numberOf('taxa de faltas');
  if (missRate !== '33,3%') throw new Error('Taxa de faltas: ' + missRate);
  const row = await panelRow('Sessões', PROF);
  if (!row || !/\t3\t2\t1\t33,3%/.test(row)) throw new Error('Linha de sessões: ' + row);
  const csv = await exportCsv('Sessões', 'sessoes-');
  if (!csv.startsWith('﻿Profissional;Marcadas;Realizadas;Faltas') || !csv.includes(`${PROF};3;2;1;33,33`)) throw new Error('CSV: ' + csv.slice(0, 200));
  ok('Operacional (mês passado): 2 realizadas, 1 falta, taxa de faltas 33,3%; CSV com ponto e vírgula e vírgula decimal');

  const retention = await panelRow('Retenção', PROF);
  const notes = await panelRow('Prontuários', PROF);
  if (!retention || !notes) throw new Error('Retenção/prontuários sem a profissional: ' + retention + ' | ' + notes);
  ok('Retenção e situação dos prontuários por profissional aparecem');

  await go('Financeiro');
  await waitMain('DRE simplificada');
  await selectPreset('Mês passado');
  const last = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const lastLabel = last.toLocaleDateString('pt-BR', { month: 'long' }).replace(/^./, (c) => c.toUpperCase());
  await page.waitForFunction(() => [...document.querySelectorAll('main .panel tbody tr')].length === 1, { timeout: 15000 });
  const dre = await panelRow('DRE', lastLabel);
  if (!dre.includes('R$ 500,00') || !dre.includes('-R$ 120,00') || !dre.includes('R$ 250,00')) throw new Error('DRE: ' + dre);
  await clickText('.tab', 'Previsão');
  await waitMain('Previsão por vencimento');
  const forecast = await panelRow('Previsão por vencimento', 'Vencidos até hoje');
  const forecastMonths = await page.$$eval('main .panel tbody tr', (rows) => rows.length);
  if (!forecast || forecastMonths !== 13) throw new Error(`Previsão: ${forecast} / ${forecastMonths} linhas`);
  ok('Previsão financeira: vencidos separados de 12 meses futuros');
  await clickText('.tab', 'Despesas');
  await waitMain('Por categoria');
  const systems = await panelRow('Por categoria', 'Sistemas');
  if (!systems || !systems.includes('R$ 120,00') || !systems.includes('R$ 60,00') || !systems.includes('100%')) {
    throw new Error('Comparação de despesas: ' + systems);
  }
  ok('Despesas: participação e variação de 100% contra o mesmo mês do ano anterior');
  await clickText('.tab', 'Por profissional');
  await waitMain('Faturado e recebido');
  const revenue = await panelRow('Faturado e recebido', PROF);
  if (!revenue || !revenue.includes('Individual') || !revenue.includes('R$ 500,00') || !revenue.includes('R$ 250,00')) throw new Error('Faturamento: ' + revenue);
  await clickText('.tab', 'Formas de pagamento');
  await waitMain('Recebimentos por forma de pagamento');
  const pix = await panelRow('Recebimentos por forma', 'PIX');
  if (!pix || !pix.includes('R$ 250,00')) throw new Error('PIX: ' + pix);
  await clickText('.tab', 'Inadimplência');
  await waitMain('Inadimplência por paciente');
  const aging = await panelRow('Inadimplência', 'Paciente Relatório E2E');
  if (!aging || !aging.includes('R$ 250,00')) throw new Error('Inadimplência: ' + aging);
  ok('Financeiro (mês passado): DRE com R$ 500 faturados, R$ 250 recebidos e despesa de R$ 120; por profissional; PIX; inadimplência de R$ 250');

  await go('Comparativo anual');
  await waitMain('Indicadores no acumulado', 'Sessões realizadas', 'Faturado');
  const sessionsRow = await panelRow('Indicadores no acumulado', 'Sessões realizadas');
  if (!sessionsRow || !/Sessões realizadas\t2\t0/.test(sessionsRow)) throw new Error('Comparativo: ' + sessionsRow);
  await page.evaluate(() => [...document.querySelectorAll('main tbody tr')].find((tr) => tr.innerText.startsWith('Sessões realizadas')).querySelector('button').click());
  await waitMain('Sessões realizadas: mês a mês');
  const bars = await page.$$eval('.chart-box path', (els) => els.length);
  if (bars < 1) throw new Error('Gráfico do comparativo sem barras');
  ok(`Comparativo anual: sessões realizadas 2 x 0 no acumulado; gráfico mês a mês (${bars} barra)`);

  await go('Comercial');
  await waitMain('Relatório comercial', 'Por origem', 'Campanhas');
  ok('Relatório comercial abre com origens, campanhas, etapas e motivos');

  await go('Usuários');
  await waitText(ownerEmail);
  await newUser('Teste Gerente Relatórios', MANAGER_EMAIL, ['manager']);
  await logout();
  await login(MANAGER_EMAIL, 'Senha-Bloco1-ok');
  await waitText('Olá, Teste');
  await go('Financeiro');
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Relatório financeiro', { timeout: 10000 });
  const tabs = await page.$$eval('main .tab', (els) => els.map((e) => e.textContent));
  if (tabs.join(',') !== 'Formas de pagamento,Inadimplência') throw new Error('Abas da Gerente: ' + tabs);
  await go('Comparativo anual');
  await waitMain('Sessões realizadas');
  if ((await mainText()).includes('Faturado')) throw new Error('Gerente viu faturamento no comparativo');
  ok('Gerente: financeiro só com formas de pagamento e inadimplência; comparativo sem valores em dinheiro');

  await page.setViewport({ width: 390, height: 844 });
  await go('Operacional');
  await waitMain('sessões realizadas');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const active = await page.evaluate(() => { const r = document.querySelector('.rail-link.active').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; });
  if (overflow > 1 || !active) throw new Error(`Celular: rolagem ${overflow}, módulo visível ${active}`);
  await page.screenshot({ path: process.env.SHOT_DIR + '/relatorios-celular.png' });
  ok('Celular: relatório sem rolagem da página e o módulo atual visível na barra');

  console.log(problems.length ? 'Erros de página: ' + problems.join(' | ') : 'Sem erros de página');
} catch (error) {
  console.log('✘ Falhou:', error.message);
  console.log('  em ' + (error.stack ?? '').split('\n').filter((l) => l.includes('/e2e/')).map((l) => l.trim().replace(/^.*\/e2e\//, '')).join(' ← '));
  await page.screenshot({ path: process.env.SHOT_DIR + '/bloco9-falha.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
