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
const N = (s) => s.replace(/ /g, ' ');
const MANAGER = 'Teste Gerente Tarefas';
const MANAGER_EMAIL = 'teste-tarefas@example.test';
const MONTHLY = 'Fechar caixa do mês E2E';
const TODAY_TASK = 'Conferir agenda E2E';
const pad = (n) => String(n).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const br = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const today = new Date();
const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, Math.min(today.getDate(), new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate()));
const selectByText = async (name, label) => {
  const value = await page.$eval(`dialog[open] select[name=${name}]`, (el, l) => [...el.options].find((o) => o.textContent.startsWith(l))?.value, label);
  if (value === undefined) throw new Error(`Opção ${label} não encontrada em ${name}`);
  await page.select(`dialog[open] select[name=${name}]`, value);
};
const taskRow = (title) => page.evaluate((t) => [...document.querySelectorAll('.task-row')].map((e) => e.innerText).find((x) => x.includes(t)) ?? null, title);
const waitTask = (title, ...parts) => page.waitForFunction((t, ps) => [...document.querySelectorAll('.task-row')].some((e) => e.innerText.includes(t) && ps.every((p) => e.innerText.includes(p))), { timeout: 10000, polling: 200 }, title, parts);
const bellBadge = () => page.$eval('.bell .badge', (e) => e.textContent).catch(() => null);

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  await go('Usuários');
  await waitText(ownerEmail);
  await newUser(MANAGER, MANAGER_EMAIL, ['manager']);

  const pages = await menuPages();
  for (const p of ['Minhas tarefas', 'Tarefas da equipe', 'Recorrentes']) if (!pages.includes(p)) throw new Error('Menu sem ' + p);
  ok('Proprietário(a): módulo Tarefas com Minhas tarefas, Tarefas da equipe e Recorrentes');

  await go('Minhas tarefas');
  await clickText('button', 'Nova tarefa');
  await typeIn('title', MONTHLY);
  await page.waitForFunction((m) => [...document.querySelectorAll('dialog[open] select[name=assignee] option')].some((o) => o.textContent === m), { timeout: 10000 }, MANAGER);
  await selectByText('assignee', MANAGER);
  await page.select('dialog[open] select[name=priority]', 'high');
  await page.select('dialog[open] select[name=frequency]', 'monthly');
  await page.$eval('dialog[open] input[name=dueDate]', (el, v) => { el.value = v; }, key(today));
  await page.$eval('dialog[open] input[name=dueTime]', (el) => { el.value = '18:00'; });
  await clickText('dialog[open] button', 'Criar tarefa');
  await waitText('Tarefa recorrente criada.');
  await clickText('button', 'Nova tarefa');
  await typeIn('title', TODAY_TASK);
  await page.$eval('dialog[open] input[name=dueDate]', (el, v) => { el.value = v; }, key(today));
  await clickText('dialog[open] button', 'Criar tarefa');
  await waitText('Tarefa criada.');
  await waitTask(TODAY_TASK, 'Hoje');
  ok('Tarefa mensal (alta, 18:00) atribuída à Gerente e tarefa própria para hoje');

  await go('Recorrentes');
  await page.waitForFunction((t, d) => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes(t) && tr.innerText.includes('Todo mês') && tr.innerText.includes(d) && tr.innerText.includes('Ativa')), { timeout: 10000 }, MONTHLY, br(today));
  await go('Tarefas da equipe');
  await waitTask(MONTHLY, MANAGER, 'Todo mês', 'Alta');
  if (!N(await page.$eval('.numbers', (e) => e.innerText)).includes(MANAGER)) throw new Error('Resumo por pessoa sem a Gerente');
  ok('Recorrentes mostra a regra (próxima hoje); equipe mostra a tarefa e o resumo por pessoa');

  await logout();
  await login(MANAGER_EMAIL, 'Senha-Bloco1-ok');
  await waitText('Olá, Teste');
  await page.waitForFunction(() => document.querySelector('.bell .badge'), { timeout: 15000 });
  await page.click('.bell .icon-btn');
  await page.waitForFunction((t) => document.querySelector('#avisos-menu:not([hidden])')?.innerText.includes('Nova tarefa: ' + t), { timeout: 10000 }, MONTHLY);
  if (!N(await page.$eval('#avisos-menu', (e) => e.innerText)).includes('vence hoje')) throw new Error('Sino sem o resumo "vence hoje"');
  await page.evaluate((t) => [...document.querySelectorAll('#avisos-menu .pop-item')].find((b) => b.innerText.includes('Nova tarefa: ' + t)).click(), MONTHLY);
  await page.waitForFunction((t) => document.querySelector('dialog[open] h2')?.textContent === t, { timeout: 10000 }, MONTHLY);
  ok('Gerente: sino com o aviso "Nova tarefa" e "vence hoje"; o aviso abre a tarefa');

  await page.waitForSelector('dialog[open] textarea[name=body]');
  await page.type('dialog[open] textarea[name=body]', 'Separei os comprovantes.');
  await clickText('dialog[open] button', 'Comentar');
  await page.waitForFunction(() => document.querySelector('dialog[open] .task-history')?.innerText.includes('Separei os comprovantes.'), { timeout: 10000 });
  await clickText('dialog[open] button', 'Concluir');
  await waitText('Concluída. A próxima ocorrência já foi criada.');
  await page.waitForFunction(() => document.querySelector('dialog[open] .task-history')?.innerText.includes('para Concluída'), { timeout: 10000 });
  await clickText('dialog[open] button', 'Fechar');
  await waitTask(MONTHLY, br(nextMonth), 'Todo mês');
  const rows = await page.$$eval('.task-row', (els, t) => els.filter((e) => e.innerText.includes(t)).length, MONTHLY);
  if (rows !== 1) throw new Error('Em aberto deveria ter só a próxima ocorrência: ' + rows);
  ok(`Gerente comenta e conclui; a próxima ocorrência nasce em ${br(nextMonth)} (mesmo dia do mês seguinte)`);

  await page.evaluate(() => [...document.querySelectorAll('.tab')].find((b) => b.textContent.startsWith('Com concluídas')).click());
  await page.waitForFunction((t) => [...document.querySelectorAll('.task-row.closed')].some((e) => e.innerText.includes(t)), { timeout: 10000 }, MONTHLY);
  ok('Concluída aparece riscada em "Com concluídas"');

  await logout();
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  await page.waitForFunction((t) => document.querySelector('.todo')?.innerText.includes(t), { timeout: 10000 }, TODAY_TASK);
  await page.click('.bell .icon-btn');
  await page.waitForFunction((t) => {
    const text = document.querySelector('#avisos-menu:not([hidden])')?.innerText ?? '';
    return text.includes('Tarefa concluída: ' + t) && text.includes('Comentário em: ' + t);
  }, { timeout: 10000 }, MONTHLY);
  await clickText('#avisos-menu button', 'Marcar todos como lidos');
  await page.waitForFunction(() => !document.querySelector('#avisos-menu .pop-item.unread'), { timeout: 10000 });
  await page.keyboard.press('Escape');
  ok('Proprietário(a): painel com a tarefa de hoje; avisos de conclusão e comentário, marcados como lidos');

  await go('Tarefas da equipe');
  await page.waitForFunction(() => document.querySelector('main h1')?.textContent === 'Tarefas da equipe');
  await page.waitForFunction(() => document.querySelector('.task-row'), { timeout: 10000 });
  await page.evaluate(() => [...document.querySelectorAll('.tab')].find((b) => b.textContent.startsWith('Com concluídas')).click());
  await page.waitForFunction((t) => [...document.querySelectorAll('.task-row.closed')].some((e) => e.innerText.includes(t)), { timeout: 10000 }, MONTHLY);
  await page.evaluate((t) => [...document.querySelectorAll('.task-row.closed .task-main')].find((e) => e.innerText.includes(t)).click(), MONTHLY);
  await page.waitForFunction((m) => document.querySelector('dialog[open] .facts')?.innerText.includes('por ' + m), { timeout: 10000 }, MANAGER);
  await clickText('dialog[open] button', 'Fechar');
  ok('Equipe: a ocorrência concluída registra quem concluiu e quando');

  await page.click(`.task-row:not(.closed) .task-check[aria-label="Concluir: ${TODAY_TASK}"]`).catch(async () => {
    await go('Minhas tarefas');
    await page.waitForSelector(`.task-check[aria-label="Concluir: ${TODAY_TASK}"]`);
    await page.click(`.task-check[aria-label="Concluir: ${TODAY_TASK}"]`);
  });
  await waitText('Tarefa concluída.');
  await go('Recorrentes');
  await page.waitForFunction((t, d) => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes(t) && tr.innerText.includes(d)), { timeout: 10000 }, MONTHLY, br(nextMonth));
  await page.evaluate((t) => [...[...document.querySelectorAll('tbody tr')].find((tr) => tr.innerText.includes(t)).querySelectorAll('button')].find((b) => b.textContent === 'Pausar').click(), MONTHLY);
  await waitText('Tarefa recorrente pausada.');
  await page.waitForFunction((t) => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes(t) && tr.innerText.includes('Pausada')), { timeout: 10000 }, MONTHLY);
  ok('Check conclui a tarefa própria; regra pausada');

  await page.setViewport({ width: 390, height: 844 });
  await go('Minhas tarefas');
  await page.waitForSelector('.panel');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error('Rolagem horizontal no celular: ' + overflow);
  await page.screenshot({ path: process.env.SHOT_DIR + '/tarefas-celular.png' });
  ok('Tarefas no celular sem rolagem horizontal');

  console.log(problems.length ? 'Erros de página: ' + problems.join(' | ') : 'Sem erros de página');
} catch (error) {
  console.log('✘ Falhou:', error.message);
  await page.screenshot({ path: process.env.SHOT_DIR + '/bloco7-falha.png', fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
