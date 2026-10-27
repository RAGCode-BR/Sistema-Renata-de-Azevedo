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

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  const ownerMenu = await menuPages();
  if (!ownerMenu.includes('Usuários') || ownerMenu.includes('Prontuários')) throw new Error(`menu: ${ownerMenu}`);
  ok(`Proprietário(a): menu ${ownerMenu.join(', ')} (sem Prontuários)`);

  await go('Usuários');
  await waitText(ownerEmail);
  if (!(await rowOf(ownerEmail)).includes('Proprietário(a)')) throw new Error('perfil do Arthuro');
  ok('Contas existentes aparecem com os perfis convertidos');

  await go('Profissionais');
  await clickText('button', 'Nova profissional');
  await typeIn('name', 'Teste Atende');
  await typeIn('email', 'teste-atende@example.test');
  await clickText('dialog[open] button', 'Cadastrar profissional');
  await waitText('Profissional cadastrada.');

  await clickText('button', 'Nova profissional');
  await typeIn('name', 'Teste Acesso');
  await typeIn('email', 'teste-acesso-prof@example.test');
  await typeIn('specialty', 'Psicologia');
  await page.type('dialog[open] input[aria-label="Nova etiqueta"]', 'Infantil');
  await clickText('dialog[open] button', '+ Adicionar');
  await page.select('dialog[open] select[name=color]', '#5B806B');
  await page.click('dialog[open] input[name=commission_sessions]');
  await page.click('dialog[open] input[name=access]');
  await typeIn('password', 'Senha-Acesso-123!');
  await (await page.$('dialog[open] input[accept="image/jpeg,image/png"]')).uploadFile(`${process.env.FIXTURES_DIR}/foto-teste.png`);
  await (await page.$('dialog[open] input[multiple]')).uploadFile(`${process.env.FIXTURES_DIR}/declaracao-teste.pdf`);
  await page.waitForFunction(() => document.querySelector('dialog[open]')?.innerText.includes('declaracao-teste.pdf'), { timeout: 5000 });
  await clickText('dialog[open] button', 'Cadastrar profissional');
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes('Teste Acesso') && tr.innerText.includes('Infantil')),
      { timeout: 10000 });
  } catch (failure) {
    console.log('  diagnóstico cadastro: ' + JSON.stringify(await page.evaluate(() => ({ modal: document.querySelector('dialog[open]')?.innerText.slice(-1000),
      rows: [...document.querySelectorAll('tbody tr')].map((tr) => tr.innerText.slice(0, 200)) }))));
    throw failure;
  }
  await page.evaluate(() => [...document.querySelectorAll('tbody tr')].find((tr) => tr.innerText.includes('Teste Acesso')).querySelector('button').click());
  try {
    await page.waitForFunction(() => document.querySelector('dialog[open]')?.innerText.includes('declaracao-teste.pdf'), { timeout: 10000 });
  } catch (failure) {
    console.log('  diagnóstico anexo: ' + JSON.stringify(await page.evaluate(() => document.querySelector('dialog[open]')?.innerText.slice(-1000))));
    throw failure;
  }
  await page.waitForSelector('dialog[open] img[alt="Foto da profissional"]', { timeout: 10000 });
  await clickText('dialog[open] button', 'Cancelar');
  ok('Cadastro profissional: foto, anexo, etiqueta, cor, comissão e acesso no mesmo formulário');

  await go('Usuários');
  await waitText(ownerEmail);
  if (!(await rowOf('teste-acesso-prof@example.test')).includes('Profissional')) throw new Error('Conta vinculada não criada');
  ok('Acesso do profissional criou a conta com o perfil Profissional');
  await newUser('Teste Dona Atende', 'teste-dona-atende@example.test', ['owner', 'professional'], 'Teste Atende');
  if (!(await rowOf('teste-dona-atende@example.test')).includes('Proprietário(a) · Profissional')) throw new Error('dois perfis');
  await newUser('Teste Gerente', 'teste-gerente@example.test', ['manager']);
  ok('Usuários criados com um e com dois perfis');

  await page.evaluate((e) => [...document.querySelectorAll('tbody tr')].find((tr) => tr.textContent.includes(e)).querySelector('button').click(), ownerEmail);
  await page.waitForSelector('dialog[open] input[name=roles]');
  const locks = await page.evaluate(() => ({
    owner: document.querySelector('dialog[open] input[name=roles][value=owner]').disabled,
    active: document.querySelector('dialog[open] input[name=active]').disabled
  }));
  if (!locks.owner || !locks.active) throw new Error(`travas da própria conta: ${JSON.stringify(locks)}`);
  await clickText('dialog[open] button', 'Cancelar');
  ok('Na própria conta, "Proprietário(a)" e "Conta ativa" ficam travados');

  await editUser('teste-gerente@example.test', () => page.click('dialog[open] input[name=roles][value=reception]'));
  await page.waitForFunction(() => document.body.innerText.includes('Gerente · Recepção'), { timeout: 10000 });
  ok('Perfis editados: Gerente · Recepção');

  await editUser('teste-gerente@example.test', () => page.click('dialog[open] input[name=active]'));
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.textContent.includes('teste-gerente@example.test') && tr.textContent.includes('Inativa')), { timeout: 10000 });
  await logout();
  await login('teste-gerente@example.test', 'Senha-Bloco1-ok');
  await waitText('Esta conta não tem acesso ao sistema.');
  ok('Conta desativada não entra');

  await login(ownerEmail, ownerPassword);
  await waitText('Olá, ');
  await go('Usuários');
  await waitText('teste-gerente@example.test');
  await editUser('teste-gerente@example.test', async () => {
    await page.click('dialog[open] input[name=active]');
    await page.click('dialog[open] input[name=roles][value=reception]');
  });
  await logout();
  await login('teste-gerente@example.test', 'Senha-Bloco1-ok');
  await waitText('Olá, ');
  const managerMenu = await menuPages();
  if (managerMenu.includes('Usuários') || managerMenu.includes('Prontuários') || !managerMenu.includes('Profissionais')) throw new Error(`menu gerente: ${managerMenu}`);
  await page.evaluate(() => { location.hash = '#/usuarios'; });
  await waitText('Olá, ');
  ok(`Reativada, a Gerente entra: menu ${managerMenu.join(', ')}; endereço de Usuários cai na Agenda`);

  await logout();
  await login('teste-dona-atende@example.test', 'Senha-Bloco1-ok');
  await waitText('Olá, ');
  const bothMenu = await menuPages();
  if (!bothMenu.includes('Usuários') || !bothMenu.includes('Prontuários')) throw new Error(`menu dois perfis: ${bothMenu}`);
  await page.click('.avatar-btn');
  await page.waitForSelector('#conta-menu:not([hidden])');
  const title = await page.$eval('#conta-menu .pop-title', (e) => e.textContent);
  if (!title.includes('Proprietário(a) · Profissional')) { await page.screenshot({ path: `${process.env.SHOT_DIR}/pop-fail.png` }); throw new Error(`menu da conta: ${title}`); }
  ok(`Dois perfis: menu ${bothMenu.join(', ')}; conta mostra "Proprietário(a) · Profissional"`);
  await logout();
  await login('teste-acesso-prof@example.test', 'Senha-Acesso-123!');
  await waitText('Olá, Teste');
  const professionalMenu = await menuPages();
  if (!professionalMenu.includes('Prontuários') || professionalMenu.includes('Usuários')) throw new Error(`menu profissional: ${professionalMenu}`);
  ok('Profissional criado no cadastro consegue entrar com o perfil correto');
} catch (error) {
  console.log(`✖ FALHA após o passo ${n}: ${error.message}`);
  console.log('  em ' + (error.stack ?? '').split('\n').filter((l) => l.includes('/e2e/')).map((l) => l.trim().replace(/^.*\/e2e\//, '')).join(' ← '));
  process.exitCode = 1;
} finally {
  console.log(problems.length ? `Erros de página: ${problems.join(' | ')}` : 'Sem erros de página');
  await browser.close();
}
