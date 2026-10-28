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
  const value = await page.$eval('dialog[open] select[name=professionalId]', (el) => [...el.options].find((o) => o.textContent === 'Teste Prontuario')?.value);
  await page.select('dialog[open] select[name=professionalId]', value);
  await page.waitForFunction(() => document.querySelector('dialog[open] select[name=patientId]').textContent.includes('Paciente Prontuario'));
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

const popupUrl = async (action, expected) => {
  const created = new Promise((resolve) => browser.once('targetcreated', resolve));
  await action();
  const target = await created;
  for (let i = 0; i < 40 && !target.url().includes(expected); i++) await new Promise((r) => setTimeout(r, 250));
  return target;
};

try {
  await page.goto(base, { waitUntil: 'networkidle0' });
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  await go('Profissionais');
  await clickText('button', 'Nova profissional');
  await typeIn('name', 'Teste Prontuario');
  await typeIn('email', 'teste-prontuario-prof@example.test');
  await clickText('dialog[open] button', 'Cadastrar profissional');
  await toast('Profissional cadastrada.');
  await go('Usuários');
  await waitText(ownerEmail);
  await newUser('Teste Prontuario', 'teste-prontuario@example.test', ['professional'], 'Teste Prontuario');
  await go('Pacientes');
  await clickText('button', 'Novo paciente');
  await typeIn('name', 'Paciente Prontuario');
  await (await page.waitForFunction(() => [...document.querySelectorAll('dialog[open] label.check')].find((l) => l.textContent.trim() === 'Teste Prontuario')?.querySelector('input'))).asElement().click();
  await clickText('dialog[open] button', 'Cadastrar paciente');
  await toast('Paciente cadastrado.');
  await go('Agenda');
  await waitText('no período');
  // Dois dias atrás: com prazo de 24 h, já está atrasada a qualquer hora do dia.
  await newSession({ when: at(new Date(), -2, 10) });
  await toast('Sessão agendada.');
  await goWeekOf(at(new Date(), -2, 10));
  await openCard('Paciente Prontuario');
  await clickText('dialog[open] button', 'Realizada');
  await toast('Presença registrada.');
  await go('Configurações');
  await page.waitForSelector('input[name=hours]');
  await page.$eval('input[name=hours]', (el) => { el.value = ''; });
  await page.type('input[name=hours]', '24');
  await clickText('button', 'Salvar');
  await toast('Configurações salvas.');
  await go('Controle de prontuários');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes('Paciente Prontuario') && tr.innerText.includes('Pendente · atrasado')), { timeout: 10000 });
  ok('Gerência: prazo de 24 h configurado; controle mostra a sessão de ontem como "Pendente · atrasado"');

  await logout();
  await login('teste-prontuario@example.test', 'Senha-Bloco1-ok');
  await waitText('Olá, Teste');
  await page.goto(`${base}/#/tarefas`, { waitUntil: 'networkidle0' });
  await waitText('Tarefas');
  if (!await page.$('main button')) throw new Error('Profissional sem botão para criar tarefa para paciente');
  const taskPage = await page.$eval('main', (element) => element.innerText);
  if (!taskPage.includes('Nova tarefa para paciente') || taskPage.includes('Nova pendência') || taskPage.includes('Para mim')) {
    throw new Error('Profissional recebeu o fluxo antigo de tarefas');
  }
  ok('Profissional: Tarefas abre o envio para pacientes, sem criar tarefa para si');
  await page.goto(`${base}/#/inicio`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelector('.todo')?.innerText.includes('Registrar evolução de Paciente Prontuario'), { timeout: 10000 });
  if (!(await page.$eval('.todo', (e) => e.innerText)).includes('fora do prazo')) throw new Error('pendência sem "fora do prazo"');
  await page.evaluate(() => [...document.querySelectorAll('.todo a.task')].find((a) => a.innerText.includes('Paciente Prontuario')).click());
  await page.waitForFunction(() => document.querySelector('select[name=appointmentId]')?.value, { timeout: 10000 });
  ok('Profissional: pendência "fora do prazo" no Início abre o prontuário já na sessão');

  await page.type('textarea[name=body]', 'Primeira versão da evolução.');
  await page.$eval('textarea[name=body]', (el) => el.setSelectionRange(0, 'Primeira'.length));
  await page.click('button[aria-label="Negrito"]');
  await clickText('button', 'Visualizar formatação');
  await page.waitForFunction(() => document.querySelector('.clinical-preview strong')?.textContent === 'Primeira', { timeout: 5000 });
  await clickText('button', 'Voltar ao texto');
  await clickText('button', 'Salvar rascunho');
  await toast('Rascunho salvo.');
  await page.waitForFunction(() => [...document.querySelectorAll('.entry .clinical-text strong')].some((el) => el.textContent === 'Primeira'), { timeout: 5000 });
  ok('Editor: negrito e prévia aparecem no rascunho salvo');
  await page.$eval('textarea[name=body]', (el) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, 'Evolução revisada da sessão.'); el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await clickText('button', 'Salvar rascunho');
  await toast('Rascunho salvo.');
  await page.waitForFunction(() => [...document.querySelectorAll('.entry')].some((e) => e.innerText.includes('Rascunho') && e.innerText.includes('Versões anteriores (1)')), { timeout: 10000 });
  await clickText('button', 'Versões anteriores (1)');
  await page.waitForFunction(() => document.querySelector('dialog[open]')?.innerText.includes('Primeira versão da evolução.'), { timeout: 10000 });
  await clickText('dialog[open] button', 'Fechar');
  ok('Rascunho salvo duas vezes; a versão anterior fica guardada e visível');

  await clickText('button', 'Finalizar evolução');
  await clickText('dialog[open] button', 'Finalizar');
  await toast('Evolução finalizada.');
  await page.waitForFunction(() => [...document.querySelectorAll('.entry')].some((e) => e.innerText.includes('Finalizada em') && e.innerText.includes('Retificar') && !e.innerText.includes('Editar')), { timeout: 10000 });
  await clickText('button', 'Retificar');
  await page.waitForSelector('dialog[open] textarea[name=body]');
  await page.$eval('dialog[open] textarea[name=body]', (el) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, 'Evolução revisada da sessão, com o horário correto.');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type('dialog[open] input[name=reason]', 'Horário informado errado');
  await clickText('dialog[open] button', 'Registrar retificação');
  await toast('Retificação registrada.');
  await page.waitForFunction(() => document.querySelector('main').innerText.includes('Motivo: Horário informado errado')
    && document.querySelector('main').innerText.includes('Este registro foi retificado'), { timeout: 10000 });
  ok('Finalizada fica sem "Editar"; retificação registrada com motivo, e o original continua visível');

  await clickText('.tab', 'Conceitualização');
  await page.waitForSelector('select[aria-label="Aplicar modelo"]');
  const clinic = await page.$eval('select[aria-label="Aplicar modelo"]', (el) => [...el.options].find((o) => o.textContent.includes('(clínica)'))?.value);
  await page.select('select[aria-label="Aplicar modelo"]', clinic);
  await page.waitForSelector('textarea[name=motivo]');
  await page.type('textarea[name=motivo]', 'Ansiedade no trabalho.');
  await clickText('button', 'Salvar conceitualização');
  await toast('Conceitualização salva.');
  await page.waitForSelector('textarea[name=objetivos]');
  await page.type('textarea[name=objetivos]', 'Reduzir a evitação.');
  await clickText('button', 'Salvar conceitualização');
  await toast('Conceitualização salva.');
  await page.waitForFunction(() => document.querySelector('main').innerText.includes('1 versão anterior guardada'), { timeout: 10000 });
  ok('Conceitualização pelo modelo da clínica, salva duas vezes (versão anterior guardada)');

  await clickText('button', 'Meus modelos');
  await clickText('dialog[open] button', 'Novo modelo');
  await page.waitForSelector('dialog[open] textarea[name=sections]');
  await page.$eval('dialog[open] input[name=name]', (el) => { el.value = 'Modelo TCC'; });
  await page.$eval('dialog[open] textarea[name=sections]', (el) => { el.value = 'Situação — gatilho\nPensamentos automáticos\nEmoções\nComportamentos'; });
  await clickText('dialog[open] button', 'Salvar modelo');
  await toast('Modelo salvo.');
  await page.waitForFunction(() => [...document.querySelectorAll('select[aria-label="Aplicar modelo"] option')].some((o) => o.textContent === 'Modelo TCC'), { timeout: 10000 });
  ok('Modelo próprio "Modelo TCC" criado e disponível para aplicar');
  await clickText('dialog[open] button', 'Fechar');
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));

  await clickText('.tab', 'Documentos clínicos');
  await (await page.waitForSelector('input[type=file]')).uploadFile(`${FILES}/contrato-teste.pdf`);
  await page.type('main form input[name=title]', 'Laudo teste');
  await clickText('button', 'Enviar documento');
  await toast('Documento clínico enviado.');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes('Laudo teste')), { timeout: 10000 });
  const doc = await popupUrl(() => clickText('button', 'Abrir'), '/storage/v1/object/sign/');
  if (!doc.url().includes('/storage/v1/object/sign/clinical-documents/')) throw new Error(`link: ${doc.url()}`);
  const pdf = await fetch(doc.url());
  if (!pdf.ok || !(await pdf.text()).startsWith('%PDF')) throw new Error('documento clínico não abriu');
  (await doc.page())?.close();
  ok('Documento clínico enviado e aberto por link assinado da Edge Function');

  await clickText('.tab', 'Anotações pessoais');
  await page.waitForSelector('textarea[name=body]');
  await page.type('textarea[name=body]', 'Nota pessoal teste, não exportar.');
  await clickText('button', 'Salvar anotação');
  await toast('Anotação salva.');

  const exported = await popupUrl(() => page.evaluate(() => [...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'Exportar prontuário').click()), 'prontuario-impressao');
  const exportPage = await exported.page();
  await exportPage.waitForFunction(() => document.body.innerText.includes('Esta exportação foi registrada.'), { timeout: 15000 });
  const exportText = await exportPage.evaluate(() => document.body.innerText);
  if (!exportText.includes('com o horário correto') || !exportText.includes('Ansiedade no trabalho.')) throw new Error('exportação sem retificação ou conceitualização');
  if (exportText.includes('Nota pessoal teste')) throw new Error('exportação incluiu anotação pessoal');
  await exportPage.screenshot({ path: `${process.env.SHOT_DIR}/prontuario-exportacao.png`, fullPage: true });
  await exportPage.close();
  ok('Exportação: evoluções finalizadas, retificação e conceitualização; sem a anotação pessoal');

  await logout();
  await login(ownerEmail, ownerPassword);
  await waitText(`Olá, ${process.env.OWNER_FIRST_NAME}`);
  await go('Controle de prontuários');
  await page.waitForFunction(() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.innerText.includes('Paciente Prontuario') && tr.innerText.includes('Finalizado fora do prazo')), { timeout: 10000 });
  if ((await page.$eval('main', (e) => e.innerText)).includes('Evolução revisada')) throw new Error('gerência viu conteúdo clínico');
  await page.screenshot({ path: `${process.env.SHOT_DIR}/controle-prontuarios.png`, fullPage: true });
  await go('Configurações');
  await page.waitForSelector('input[name=hours]');
  await page.$eval('input[name=hours]', (el) => { el.value = ''; });
  await page.type('input[name=hours]', '48');
  await clickText('button', 'Salvar');
  await toast('Configurações salvas.');
  ok('Gerência: "Finalizado fora do prazo" sem nenhum conteúdo clínico; prazo devolvido a 48 h');
} catch (error) {
  console.log(`✖ FALHA após o passo ${n}: ${error.message}`);
  console.log('  em ' + (error.stack ?? '').split('\n').filter((l) => l.includes('/e2e/')).map((l) => l.trim().replace(/^.*\/e2e\//, '')).join(' ← '));
  await page.screenshot({ path: `${process.env.SHOT_DIR}/prontuario-falha.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  console.log(problems.length ? `Erros de página: ${problems.join(' | ')}` : 'Sem erros de página');
  await browser.close();
}
