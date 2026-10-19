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
  // Espera a janela anterior fechar: durante o fechamento, o clique no menu não chega.
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
const at = (days, h, m) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
const numberOf = (label) => page.evaluate((l) => [...document.querySelectorAll('.number')].find((n) => n.textContent.includes(l))?.querySelector('strong').textContent, label);
const pendencies = () => page.$eval('.todo', (e) => e.innerText);
async function schedule(when) {
  await go('Agenda');
  await clickText('button', 'Nova sessão');
  const value = await page.$eval('dialog[open] select[name=professionalId]', (el) => [...el.options].find((o) => o.textContent === 'Teste Painel')?.value);
  await page.select('dialog[open] select[name=professionalId]', value);
  await page.waitForFunction(() => document.querySelector('dialog[open] select[name=patientId]').textContent.includes('Paciente Painel'));
  await page.$eval('dialog[open] input[name=startsAt]', (el, v) => { el.value = v; }, localInput(when));
  await clickText('dialog[open] button', 'Agendar');
  await waitText('Sessão agendada.');
}

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  const menu = await menuPages();
  if (menu[0] !== 'Início') throw new Error(`menu: ${menu}`);
  ok('Depois do login, a primeira página é o Início');

  // Cenário: profissional com conta, paciente, uma sessão ontem (pendente) e outra hoje mais tarde.
  await go('Profissionais');
  await clickText('button', 'Nova profissional');
  await typeIn('name', 'Teste Painel');
  await clickText('dialog[open] button', 'Cadastrar profissional');
  await waitText('Profissional cadastrada.');
  await go('Usuários');
  await waitText(ownerEmail);
  await newUser('Teste Painel', 'teste-painel@example.test', ['professional'], 'Teste Painel');
  await go('Pacientes');
  await clickText('button', 'Novo paciente');
  await typeIn('name', 'Paciente Painel');
  await (await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] label.check')].find((l) => l.textContent.trim() === 'Teste Painel')?.querySelector('input'))).asElement().click();
  await clickText('dialog[open] button', 'Cadastrar paciente');
  await waitText('Paciente cadastrado.');
  await schedule(at(-1, 10, 0));
  await schedule(at(0, 23, 0));
  ok('Cenário montado: sessão de ontem e sessão de hoje às 23:00');

  await go('Início');
  await page.waitForFunction(() => document.querySelector('.todo')?.innerText.includes('Teste Painel'), { timeout: 10000 });
  const ownerTodo = await pendencies();
  // Sessão passada ainda sem presença registrada (a evolução só fica pendente depois de registrar a presença).
  if (!/1 sessão sem presença registrada de Teste Painel/.test(ownerTodo)) throw new Error(`pendências: ${ownerTodo}`);
  if (ownerTodo.includes('Paciente Painel')) throw new Error('gerência viu o nome do paciente na pendência');
  if (Number(await numberOf('sessões hoje na clínica')) < 1) throw new Error('sessões de hoje');
  if (!(await page.$eval('.next', (e) => e.innerText)).includes('Paciente Painel')) throw new Error('próxima sessão');
  if (!(await page.$eval('main', (e) => e.innerText)).includes('23:00')) throw new Error('sessão de hoje fora da tabela');
  if (await page.$('.todo a.task[href^="#/prontuarios"]')) throw new Error('gerência recebeu atalho para prontuário');
  await page.screenshot({ path: `${process.env.SHOT_DIR}/painel-gerencia.png`, fullPage: true });
  ok('Gerência: sessões de hoje, próxima sessão e "1 sessão sem presença registrada de Teste Painel", sem atalho para o prontuário');

  await logout();
  await login('teste-painel@example.test', 'Senha-Bloco1-ok');
  await waitText('Olá, Teste');
  // A sessão de ontem ainda está sem presença: o atalho do Início leva à agenda, onde ela marca "Realizada".
  await page.waitForFunction(() => document.querySelector('.todo a.task[href^="#/agenda"]'), { timeout: 10000 });
  await page.click('.todo a.task[href^="#/agenda"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.slot-item')].some((e) => e.innerText.includes('Paciente Painel')), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('.slot-item')].find((e) => e.innerText.includes('Paciente Painel')).click());
  await page.waitForSelector('dialog[open]');
  await clickText('dialog[open] button', 'Realizada');
  await waitText('Presença registrada.');
  if (await page.$('dialog[open]')) await page.keyboard.press('Escape');
  await go('Início');
  await page.waitForFunction(() => document.querySelector('.todo')?.innerText.includes('Registrar evolução'), { timeout: 10000 });
  if (await numberOf('evoluções suas pendentes') !== '1') throw new Error('contador da profissional');
  await page.screenshot({ path: `${process.env.SHOT_DIR}/painel-profissional.png`, fullPage: true });
  ok('Profissional: atalho "sessão sem presença" leva à agenda; depois da presença, "Registrar evolução de Paciente Painel" no painel');

  await clickText('.todo a.task span', 'Registrar evolução de Paciente PainelSessão de ontem às 10:00').catch(async () => page.click('.todo a.task'));
  await page.waitForSelector('select[name=appointmentId]');
  await page.waitForFunction(() => {
    const s = document.querySelector('select[name=appointmentId]');
    return s.value && s.selectedOptions[0].textContent.includes('ontem às 10:00');
  }, { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('main select').selectedOptions[0]?.textContent === 'Paciente Painel', { timeout: 10000 });
  const patient = await page.$eval('main select', (e) => e.selectedOptions[0].textContent);
  if (patient !== 'Paciente Painel') throw new Error(`paciente: ${patient}`);
  ok('O atalho abre o prontuário já no paciente e na sessão pendente');

  await page.type('textarea[name=body]', 'Evolução registrada pelo atalho do painel.');
  await clickText('button', 'Finalizar evolução');
  await clickText('dialog[open] button', 'Finalizar');
  await waitText('Evolução finalizada.');
  await page.waitForFunction(() => document.querySelector('select[name=appointmentId]').value === '' && document.querySelector('select[name=appointmentId]').options.length === 1, { timeout: 10000 });
  ok('Evolução finalizada ligada à sessão; a sessão sai da lista de pendentes');

  await go('Início');
  await waitText('Nada pendente. Tudo em dia.');
  ok('Painel da profissional: nada pendente');

  await logout();
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  await page.waitForFunction(() => document.querySelector('.todo') && !document.querySelector('.todo').innerText.includes('Carregando'), { timeout: 10000 });
  if ((await pendencies()).includes('Teste Painel')) throw new Error('pendência continuou para a gerência');
  ok('Painel da gerência: a pendência sumiu');

  await page.setViewport({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('.numbers'));
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('rolagem horizontal no celular');
  await page.screenshot({ path: `${process.env.SHOT_DIR}/painel-celular.png`, fullPage: true });
  ok('Painel no celular sem rolagem horizontal');
} catch (error) {
  console.log(`✖ FALHA após o passo ${n}: ${error.message}`);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/painel-falha.png` }).catch(() => {});
  console.log('  em ' + (error.stack ?? '').split('\n').filter((l) => l.includes('/e2e/')).map((l) => l.trim().replace(/^.*\/e2e\//, '')).join(' ← '));
  await page.screenshot({ path: `${process.env.SHOT_DIR}/painel-falha.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  console.log(problems.length ? `Erros de página: ${problems.join(' | ')}` : 'Sem erros de página');
  await browser.close();
}
