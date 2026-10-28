// Galeria de telas: percorre as páginas da equipe que a Proprietária abre (computador e celular) e abre a janela de cadastro
// principal de cada uma, sem salvar nada. Falha se alguma tela rolar para o lado no celular ou der erro de página.
// As capturas ficam em SHOT_DIR/telas para revisão visual. Rodado por tests/run.mjs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const { createClient } = createRequire(`${process.env.PROJECT_DIR}/package.json`)('@supabase/supabase-js');
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PROF = { email: 'teste-galeria-prof@example.test', password: `Galeria-${crypto.randomBytes(8).toString('hex')}` };
let professionalId = null;

const [base, ownerEmail, ownerPassword] = process.argv.slice(2);
const OUT = `${process.env.SHOT_DIR}/telas`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// Telas que só a profissional abre (prontuário e formulários dos pacientes dela).
const PROFESSIONAL_ROUTES = ['prontuarios', 'formularios-pacientes'];
const ROUTES = [
  'inicio', 'agenda', 'conversas', 'google-agenda', 'pacientes', 'controle-prontuarios', 'tarefas', 'financeiro', 'cobrancas', 'despesas', 'repasses', 'precos', 'comercial', 'comercial-campanhas',
  'comercial-painel', 'comercial-configuracoes', 'relatorios', 'relatorios-financeiro', 'relatorios-comercial',
  'relatorios-desempenho', 'relatorios-comparativo', 'profissionais', 'usuarios', 'configuracoes'
];
// Só botões que abrem janela de cadastro; nada que exporte, sincronize ou envie.
const OPENS_FORM = /^(Nov[oa]|Agendar|Cadastrar|Adicionar|Lançar|Registrar|Criar|Bloquear)/;

let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const problems = [];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage();
const cdp = await page.createCDPSession();
page.on('pageerror', (e) => problems.push(`${page.url()}: ${e.message}`));

// Auditoria de alinhamento, medida na tela:
// 1. controles na mesma linha visual (campos, listas, botões) com a mesma altura e o mesmo centro;
// 2. em cada linha de tabela, o texto de cada célula centralizado na altura da linha.
const auditAlignment = (where) => page.evaluate((where) => {
  const found = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const name = (el) => (el.getAttribute('aria-label') || el.placeholder || el.textContent || el.className || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  const scope = document.querySelector('dialog[open]') ?? document.querySelector('main');
  const sized = (el) => el.matches('.button, .input, .search input, .app-select-trigger');
  const controls = [...new Set(scope.querySelectorAll('.button, .input:not(textarea), .search input, .app-select-trigger, label.check, .field-inline, .panel-head > h2, .panel-head > .link-btn, .panel-head > .tabs, .panel-head > span, .panel-head > small'))]
    .filter((el) => !el.matches('label.check') || !el.closest('.checks, .role-checks, .charge-picks, .form-grid, .form-section, .portal-choice'))
    .filter((el) => visible(el) && !el.closest('.app-select-menu, .table, .modal-head'));
  // Um rótulo que envolve o próprio campo não é comparado com ele: fica só o elemento de dentro.
  const leaves = controls.filter((el) => !controls.some((other) => other !== el && el.contains(other)));
  const groups = new Map();
  for (const el of leaves) {
    const box = el.parentElement?.closest('.tools, .finance-toolbar, .report-filters, .agenda-toolbar, .heading, .modal-foot, .form-grid, .panel-head, .cash-flow-tools, .lead-stage-row, .named-row, .availability-controls, .form-section, .modal-body') ?? scope;
    if (!groups.has(box)) groups.set(box, []);
    groups.get(box).push(el);
  }
  for (const items of groups.values()) {
    const rows = [];
    for (const el of items) {
      const r = el.getBoundingClientRect();
      const row = rows.find((group) => group.some((other) => { const o = other.getBoundingClientRect(); return r.top < o.bottom - 4 && r.bottom > o.top + 4; }));
      if (row) row.push(el); else rows.push([el]);
    }
    for (const row of rows.filter((group) => group.length > 1)) {
      const boxes = row.map((el) => el.getBoundingClientRect());
      const heights = row.filter(sized).map((el) => Math.round(el.getBoundingClientRect().height));
      const centers = boxes.map((r) => r.top + r.height / 2);
      if (heights.length > 1 && Math.max(...heights) - Math.min(...heights) > 2) found.push(`${where}: alturas diferentes na mesma linha (${row.filter(sized).map((el) => `${name(el)}=${Math.round(el.getBoundingClientRect().height)}`).join(', ')})`);
      else if (Math.max(...centers) - Math.min(...centers) > 3) found.push(`${where}: desalinhados na mesma linha (${row.map(name).join(', ')})`);
    }
  }
  for (const tr of scope.querySelectorAll('tbody tr')) {
    if (!visible(tr) || getComputedStyle(tr).display !== 'table-row') continue;
    const row = tr.getBoundingClientRect();
    for (const td of tr.children) {
      const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT, { acceptNode: (node) => node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
      let top = Infinity, bottom = -Infinity;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) { if (rect.height) { top = Math.min(top, rect.top); bottom = Math.max(bottom, rect.bottom); } }
      }
      if (top === Infinity) continue;
      const offset = Math.abs((top + bottom) / 2 - (row.top + row.height / 2));
      if (offset > 4) found.push(`${where}: célula fora do centro da linha em ${Math.round(offset)} px ("${td.textContent.trim().slice(0, 28)}")`);
    }
  }
  return [...new Set(found)];
}, where);
const alignment = [];

async function settle() {
  await page.waitForSelector('main h1', { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('main')?.innerText.includes('Carregando'), { timeout: 10000, polling: 250 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
}

async function visit(path, suffix, mobile) {
  await page.evaluate((p) => { location.hash = `#/${p}`; }, path);
  await new Promise((r) => setTimeout(r, 300));
  await settle();
  await page.screenshot({ path: `${OUT}/${path}${suffix}.png`, fullPage: true });
  // Depois da captura (a tabela já carregou): mede o conteúdo como a própria captura de página inteira.
  const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
  const wide = cssContentSize.width > (await page.evaluate(() => window.innerWidth)) + 1;
  if (mobile && wide) problems.push(`${path}: rolagem lateral no celular`);
  alignment.push(...await auditAlignment(`${path}${suffix}`));
  const label = await page.evaluate((source) => {
    const pattern = new RegExp(source);
    const button = [...document.querySelectorAll('main .heading button, main .heading a.button, main .panel-head button')]
      .find((b) => !b.disabled && pattern.test(b.textContent.trim()));
    if (!button) return null;
    button.click();
    return button.textContent.trim();
  }, OPENS_FORM.source);
  if (!label) return null;
  const opened = await page.waitForSelector('dialog[open]', { timeout: 5000 }).then(() => true, () => false);
  if (!opened) return null;
  await new Promise((r) => setTimeout(r, 400));
  if (mobile && await page.evaluate(() => document.querySelector('dialog[open]').scrollWidth > document.querySelector('dialog[open]').clientWidth + 1)) {
    problems.push(`${path}: janela "${label}" com rolagem lateral no celular`);
  }
  await page.screenshot({ path: `${OUT}/${path}-janela${suffix}.png` });
  alignment.push(...await auditAlignment(`${path}-janela${suffix}`));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'), { timeout: 5000 }).catch(() => {});
  return label;
}

async function login(email, password) {
  await page.goto(`${base}/#/inicio`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('input[name=username]');
  await page.type('input[name=username]', email.split('@')[0]);
  await page.type('input[name=password]', password);
  await page.click('button[type=submit]');
  await page.waitForSelector('.rail-link', { timeout: 20000 });
}

async function cleanup() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users.filter((u) => u.email === PROF.email)) await admin.auth.admin.deleteUser(user.id);
  await admin.from('professionals').delete().eq('name', 'Teste Galeria Prof');
}

try {
  await page.setViewport({ width: 1366, height: 860 });
  await login(ownerEmail, ownerPassword);

  // Atalho da busca: os dois atalhos visíveis (⌘ K e Ctrl K); numa aba que se apresenta como Windows, Ctrl+K abre.
  await page.waitForSelector('.quick-trigger');
  const macKeys = await page.$eval('.quick-keys', (el) => el.innerText.replace(/\s+/g, ' ').trim());
  await (await page.$('.quick-trigger')).screenshot({ path: `${OUT}/busca-mac.png` });
  const windows = await browser.newPage();
  await windows.evaluateOnNewDocument(() => Object.defineProperty(navigator, 'platform', { get: () => 'Win32' }));
  await windows.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36');
  await windows.setViewport({ width: 1366, height: 860 });
  await windows.goto(`${base}/#/inicio`, { waitUntil: 'networkidle0' });
  await windows.waitForSelector('.quick-trigger', { timeout: 20000 });
  const winKeys = await windows.$eval('.quick-keys', (el) => el.innerText.replace(/\s+/g, ' ').trim());
  await (await windows.$('.quick-trigger')).screenshot({ path: `${OUT}/busca-windows.png` });
  await windows.keyboard.down('Control'); await windows.keyboard.press('k'); await windows.keyboard.up('Control');
  const winOpens = await windows.waitForSelector('.quick-dialog', { timeout: 5000 }).then(() => true, () => false);
  await windows.close();
  if (macKeys !== '⌘ K Ctrl K') problems.push(`atalho mostra "${macKeys}"`);
  if (winKeys !== '⌘ K Ctrl K' || !winOpens) problems.push(`atalho no Windows mostra "${winKeys}" (Ctrl+K abre: ${winOpens})`);
  else ok(`Atalho da busca: "${macKeys}" visível no Mac e no Windows; Ctrl+K abre a busca`);

  const dialogs = [];
  for (const path of ROUTES) { const label = await visit(path, '', false); if (label) dialogs.push(`${path}: ${label}`); }
  ok(`Computador: ${ROUTES.length} páginas e ${dialogs.length} janelas (${dialogs.join('; ')})`);

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'networkidle0' });
  for (const path of ROUTES) await visit(path, '-celular', true);
  ok(`Celular (390 px): ${ROUTES.length} páginas e janelas fotografadas`);

  // Profissional: prontuários e formulários (computador e celular).
  await cleanup();
  const { data: prof, error: profError } = await admin.from('professionals').insert({ name: 'Teste Galeria Prof' }).select('id').single();
  if (profError) throw new Error(profError.message);
  professionalId = prof.id;
  const { error: userError } = await admin.auth.admin.createUser({ email: PROF.email, password: PROF.password, email_confirm: true,
    user_metadata: { name: 'Teste Galeria Prof' }, app_metadata: { roles: ['professional'], professional_id: professionalId } });
  if (userError) throw new Error(userError.message);
  await page.setViewport({ width: 1366, height: 860 });
  await login(PROF.email, PROF.password);
  for (const path of PROFESSIONAL_ROUTES) await visit(path, '', false);
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'networkidle0' });
  for (const path of PROFESSIONAL_ROUTES) await visit(path, '-celular', true);
  ok(`Profissional: ${PROFESSIONAL_ROUTES.join(', ')} no computador e no celular`);

  fs.writeFileSync(`${OUT}/alinhamento.txt`, alignment.join('\n') + '\n');
  if (alignment.length) problems.push(`${alignment.length} problemas de alinhamento (lista em telas/alinhamento.txt)`);
  else ok('Alinhamento: controles da mesma linha com mesma altura e centro; células de tabela centralizadas');
  if (problems.length) throw new Error(problems.join(' | '));
  console.log('Sem rolagem lateral e sem erros de página');
} catch (error) {
  console.log('✘ Falhou: ' + error.message);
  await page.screenshot({ path: `${OUT}/falha.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  await cleanup().catch(() => {});
}
