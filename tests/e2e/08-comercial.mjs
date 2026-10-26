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
const N = (s) => (s ?? '').replace(/ /g, ' ');
const PROF = 'Teste Comercial Prof';
const SITE_LEAD = 'Lead Site E2E';
const MANUAL_LEAD = 'Lead Manual E2E';
const CAMPAIGN = 'Casal Outubro E2E';
const FUNCTION_URL = 'https://qnchebjrgnfgszrzlyue.supabase.co/functions/v1/lead-capture';
const selectByText = async (name, label) => {
  const value = await page.$eval(`dialog[open] select[name=${name}]`, (el, l) => [...el.options].find((o) => o.textContent.startsWith(l))?.value, label);
  if (value === undefined) throw new Error(`Opção ${label} não encontrada em ${name}`);
  await page.select(`dialog[open] select[name=${name}]`, value);
};
const mainText = () => page.evaluate(() => document.querySelector('main').innerText.replace(/ /g, ' '));
const dialogText = () => page.evaluate(() => document.querySelector('dialog[open]')?.innerText.replace(/ /g, ' ') ?? '');
const waitDialogText = (t) => page.waitForFunction((x) => (document.querySelector('dialog[open]')?.innerText ?? '').replace(/ /g, ' ').includes(x), { timeout: 10000, polling: 200 }, t);
const waitMain = (...parts) => page.waitForFunction((ps) => { const t = document.querySelector('main')?.innerText.replace(/ /g, ' ') ?? ''; return ps.every((p) => t.includes(p)); }, { timeout: 10000, polling: 200 }, parts);
const openCardOf = async (name) => {
  await page.waitForFunction((n) => [...document.querySelectorAll('.lead-card')].some((c) => c.innerText.includes(n)), { timeout: 10000 }, name);
  await page.evaluate((n) => [...document.querySelectorAll('.lead-card')].find((c) => c.innerText.includes(n)).click(), name);
  await page.waitForFunction((n) => document.querySelector('dialog[open] h2')?.textContent === n, { timeout: 10000 }, name);
};

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  await go('Profissionais');
  await clickText('button', 'Nova profissional');
  await typeIn('name', PROF);
  await clickText('dialog[open] button', 'Cadastrar profissional');
  await toast('Profissional cadastrada.');

  const pages = await menuPages();
  for (const p of ['Funil', 'Campanhas', 'Painel comercial', 'Configurações do comercial']) if (!pages.includes(p)) throw new Error('Menu sem ' + p);
  ok('Proprietário(a): módulo Comercial com Funil, Campanhas, Painel comercial e Configurações');

  await go('Configurações do comercial');
  await page.waitForSelector('select[name=owner]');
  const ownerValue = await page.$eval('select[name=owner]', (el, name) => [...el.options].find((o) => o.textContent.startsWith(name))?.value, process.env.OWNER_NAME);
  await page.select('select[name=owner]', ownerValue);
  await clickText('main button', 'Salvar');
  await toast('Responsável padrão salvo.');
  await clickText('main button', 'Ver códigos');
  if (!(await mainText()).includes(FUNCTION_URL)) throw new Error('Código do formulário sem o endereço da função');
  ok('Configurações: responsável padrão definido e código do formulário do site com o endereço da função');

  await go('Campanhas');
  await clickText('button', 'Nova campanha');
  await typeIn('name', CAMPAIGN);
  await page.$eval('dialog[open] input[name=name]', (el) => el.blur());
  await page.evaluate(() => { const s = [...document.querySelectorAll('dialog[open] select')][0]; const v = [...s.options].find((o) => o.textContent === 'Instagram').value; const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })); });
  await typeIn('budget', '600');
  await waitDialogText('utm_campaign=casal-outubro-e2e');
  await waitDialogText('utm_source=instagram');
  await clickText('dialog[open] button', 'Salvar');
  await toast('Campanha salva.');
  await waitMain(CAMPAIGN, 'R$ 600,00');
  ok('Campanha criada com link de anúncio (utm_source=instagram, utm_campaign=casal-outubro-e2e)');

  const response = await fetch(FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://renatadeazevedo.com.br' },
    body: JSON.stringify({ name: SITE_LEAD, phone: '(21) 97777-1234', email: 'lead-site-e2e@example.test', interest: 'Terapia de casal', location: 'Botafogo',
      message: 'Gostaria de valores.', consent: true, elapsed_ms: 8000, utm_source: 'instagram', utm_medium: 'anuncio', utm_campaign: 'casal-outubro-e2e',
      page: 'https://renatadeazevedo.com.br/terapia-de-casal/' }) });
  if (response.status !== 200) throw new Error('Formulário do site: ' + response.status + ' ' + await response.text());
  ok('Formulário do site (Edge Function) aceitou o contato com consentimento e UTM');

  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.bell .badge'), { timeout: 15000 });
  await page.click('.bell .icon-btn');
  await page.waitForFunction((n) => document.querySelector('#avisos-menu:not([hidden])')?.innerText.includes('Novo lead pelo site: ' + n), { timeout: 10000 }, SITE_LEAD);
  await page.evaluate((n) => [...document.querySelectorAll('#avisos-menu .pop-item')].find((b) => b.innerText.includes('Novo lead pelo site: ' + n)).click(), SITE_LEAD);
  await page.waitForFunction((n) => document.querySelector('dialog[open] h2')?.textContent === n, { timeout: 15000 }, SITE_LEAD);
  await waitDialogText('Instagram · ' + CAMPAIGN);
  const facts = await dialogText();
  if (!facts.includes('Terapia de casal · Botafogo') || !facts.includes('autorizou contato') || !facts.includes('Novo contato')) throw new Error('Detalhe do lead: ' + facts);
  ok('Aviso "Novo lead pelo site" abre o lead: Instagram, campanha, interesse, local e consentimento');

  await page.select('dialog[open] select[name=kind]', 'message');
  await page.type('dialog[open] input[name=body]', 'Enviei os valores pelo WhatsApp.');
  await clickText('dialog[open] button', 'Registrar');
  await waitDialogText('Enviei os valores pelo WhatsApp.');
  const stageValue = await page.$eval('dialog[open] .lead-stage-row select', (el) => [...el.options].find((o) => o.textContent === 'Em atendimento').value);
  await page.select('dialog[open] .lead-stage-row select', stageValue);
  await toast('Lead em "Em atendimento".');
  await waitDialogText('mudou a etapa de Novo contato para Em atendimento');
  await clickText('dialog[open] button', 'Agendar retorno');
  await typeIn('time', '14:30');
  await clickText('dialog[open] button', 'Agendar');
  await toast('Retorno agendado');
  await waitDialogText('agendou retorno');
  await clickText('dialog[open] button', 'Fechar');
  await clickText('.tab', 'Retornos 1');
  await waitMain(SITE_LEAD, '14:30');
  await clickText('main button', SITE_LEAD);
  await waitDialogText('Linha do tempo');
  await page.select('dialog[open] select[name=kind]', 'call');
  await page.type('dialog[open] input[name=body]', 'Retornei a ligação.');
  await clickText('dialog[open] button', 'Registrar');
  await waitDialogText('concluiu o retorno');
  await clickText('dialog[open] button', 'Fechar');
  await waitMain('Nenhum retorno pendente.');
  ok('Retorno com horário aparece no Comercial e é concluído ao registrar contato');
  await clickText('.tab', 'Quadro');
  await openCardOf(SITE_LEAD);
  await clickText('dialog[open] button', 'Agendar retorno');
  await clickText('dialog[open] button', 'Agendar');
  await waitDialogText('agendou retorno');
  await clickText('dialog[open] button', 'Cancelar retorno');
  await typeIn('reason', 'Paciente pediu outro canal.');
  await clickText('dialog[open] button', 'Cancelar retorno');
  await waitDialogText('cancelou o retorno');
  await clickText('dialog[open] button', 'Fechar');
  await clickText('.tab', 'Retornos 0');
  await waitMain('Nenhum retorno pendente.');
  ok('Retorno cancelado sai da lista e permanece na linha do tempo');

  await clickText('button', 'Novo lead');
  await typeIn('name', MANUAL_LEAD);
  await page.type('dialog[open] input[name=phone]', '21 97777-1234');
  await page.waitForFunction((n) => (document.querySelector('dialog[open] .notice')?.innerText ?? '').includes(n), { timeout: 10000 }, SITE_LEAD);
  await page.$eval('dialog[open] input[name=phone]', (el) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.type('dialog[open] input[name=phone]', '21 96666-0001');
  await selectByText('source', 'Google');
  await clickText('dialog[open] button', 'Cadastrar lead');
  await toast('Lead cadastrado.');
  await page.waitForFunction((n) => document.querySelector('dialog[open] h2')?.textContent === n, { timeout: 10000 }, MANUAL_LEAD);
  await clickText('dialog[open] button', 'Marcar como perdido');
  await selectByText('reason', 'Preço');
  await typeIn('note', 'Achou caro');
  await clickText('dialog[open] button', 'Marcar como perdido');
  await toast('Lead marcado como perdido.');
  await waitDialogText('Motivo: Preço');
  await clickText('dialog[open] button', 'Fechar');
  ok('Lead manual: aviso de duplicidade pelo telefone; marcado como perdido com motivo');

  await clickText('.tab', 'Quadro');
  await openCardOf(SITE_LEAD);
  await clickText('dialog[open] button', 'Converter em paciente');
  await page.evaluate((p) => [...document.querySelectorAll('dialog[open] label.check')].find((l) => l.textContent.trim() === p).querySelector('input').click(), PROF);
  await clickText('dialog[open] button', 'Converter');
  await toast('Lead convertido');
  await page.waitForFunction((n) => document.querySelector('main h1')?.textContent === n, { timeout: 15000 }, SITE_LEAD);
  await clickText('button', 'Editar cadastro');
  await page.waitForSelector('dialog[open] select[name=source]');
  const origin = await page.$eval('dialog[open] select[name=source]', (el) => el.options[el.selectedIndex].textContent);
  if (origin !== 'Instagram') throw new Error('Origem do paciente: ' + origin);
  await clickText('dialog[open] button', 'Cancelar');
  ok('Conversão: cadastro do paciente criado com a profissional e a origem Instagram');
  await clickText('.patient-tabs .tab', 'Histórico');
  await waitMain('Enviei os valores pelo WhatsApp.', 'Retornei a ligação.', 'Paciente cadastrado');
  if (!(await mainText()).includes('Novo contato')) throw new Error('Histórico comercial não chegou à ficha do paciente');
  ok('Histórico do paciente reúne contato comercial, conversão e cadastro');

  await go('Painel comercial');
  await waitMain('leads', 'taxa de conversão');
  const dash = await mainText();
  if (!/\n2\nleads/.test(dash) || !/\n1\nconvertidos em pacientes/.test(dash) || !dash.includes('50%') || !dash.includes('Preço')) throw new Error('Painel: ' + dash.slice(0, 600));
  ok('Painel comercial: 2 leads, 1 convertido (50%), motivo de perda "Preço"');

  await go('Campanhas');
  await page.waitForFunction((c) => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes(c)), { timeout: 10000 }, CAMPAIGN);
  const row = N(await page.evaluate((c) => [...document.querySelectorAll('tbody tr')].find((tr) => tr.innerText.includes(c)).innerText, CAMPAIGN));
  if ((row.match(/R\$ 600,00/g) ?? []).length < 3) throw new Error('Linha da campanha: ' + row);
  ok('Campanha: 1 lead, 1 convertido, custo por lead e por paciente R$ 600,00');

  await go('Configurações do comercial');
  await page.waitForSelector('main input[type=file]');
  const input = await page.$('main input[type=file]');
  await input.uploadFile(process.env.CSV_FILE);
  await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('3 linhas'), { timeout: 10000 });
  await clickText('main button', 'Importar 3 linhas');
  await page.waitForFunction(() => document.querySelector('main .notice')?.innerText.includes('1 lead importado'), { timeout: 15000 });
  const result = await page.$eval('main .notice', (el) => el.innerText);
  if (!result.includes('1 já existia') || !result.includes('1 linha sem nome ou contato')) throw new Error('Importação: ' + result);
  ok('Importação de planilha: 1 importado, 1 já existia (mesmo telefone), 1 sem contato');

  await go('Funil');
  await clickText('.tab', 'Lista');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes('Lead Planilha E2E') && tr.innerText.includes('Perdido')), { timeout: 10000 });
  ok('Lead importado aparece na lista como Perdido');

  await go('Início');
  await page.waitForFunction(() => document.querySelector('.numbers')?.innerText.includes('novos pacientes no mês'), { timeout: 10000 });
  ok('Início mostra novos pacientes e conversão');

  await page.setViewport({ width: 390, height: 844 });
  await go('Funil');
  await page.waitForSelector('.kanban');
  const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    rail: (() => { const r = document.querySelector('.rail-link.active').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; })() }));
  if (layout.overflow > 1 || !layout.rail) throw new Error('Celular: ' + JSON.stringify(layout));
  await page.screenshot({ path: process.env.SHOT_DIR + '/comercial-celular.png' });
  ok('Celular: funil sem rolagem da página e o módulo atual visível na barra inferior');

  console.log(problems.length ? 'Erros de página: ' + problems.join(' | ') : 'Sem erros de página');
} catch (error) {
  console.log('✘ Falhou:', error.message);
  console.log('  em ' + (error.stack ?? '').split('\n').filter((l) => l.includes('/e2e/')).map((l) => l.trim().replace(/^.*\/e2e\//, '')).join(' ← '));
  await page.screenshot({ path: process.env.SHOT_DIR + '/bloco8-falha.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
