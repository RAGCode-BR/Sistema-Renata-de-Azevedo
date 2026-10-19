// Verificação em duas etapas: ativar na conta, exigir para Proprietária e Gerência, entrar com o código.
// Rodado por tests/run.mjs. Gera os códigos como um app autenticador (TOTP, 30 s, 6 dígitos).
// Ao final, a exigência volta a ficar desligada (mesmo em caso de falha).
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const { createClient } = createRequire(`${process.env.PROJECT_DIR}/package.json`)('@supabase/supabase-js');
const [base] = process.argv.slice(2);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const OWNER = { email: 'teste-mfa-dona@example.test', password: `Mfa-${crypto.randomBytes(8).toString('hex')}` };
const MANAGER = { email: 'teste-mfa-gerente@example.test', password: `Mfa-${crypto.randomBytes(8).toString('hex')}` };
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const fail = (m) => { throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function totp(secret, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.replace(/[\s=]/g, '').toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const hmac = crypto.createHmac('sha1', key).update(counter).digest();
  const start = hmac[hmac.length - 1] & 0xf;
  return String((hmac.readUInt32BE(start) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
// Evita usar o mesmo código duas vezes (o Supabase recusa reutilização) esperando o próximo intervalo.
let lastWindow = 0;
async function freshCode(secret) {
  while (Math.floor(Date.now() / 30000) === lastWindow || Date.now() % 30000 > 27000) await sleep(500);
  lastWindow = Math.floor(Date.now() / 30000);
  return totp(secret);
}

async function cleanup() {
  await admin.from('clinic_settings').update({ require_mfa: false }).eq('id', true);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users.filter((u) => [OWNER.email, MANAGER.email].includes(u.email))) await admin.auth.admin.deleteUser(user.id);
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
await page.setViewport({ width: 1280, height: 860 });
const waitText = (t, timeout = 15000) => page.waitForFunction((x) => document.body.innerText.includes(x), { timeout, polling: 200 }, t);
const clickText = async (selector, label) => (await page.waitForFunction((s, x) => [...document.querySelectorAll(s)]
  .find((e) => e.textContent.replace(/[\uE000-\uF8FF]/g, '').trim() === x && !e.disabled), { timeout: 15000 }, selector, label)).asElement().click();
async function login(account) {
  await page.goto(`${base}/#/inicio`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('input[name=email]');
  await page.type('input[name=email]', account.email);
  await page.type('input[name=password]', account.password);
  await page.click('button[type=submit]');
}
// Sai apagando a sessão guardada e recarregando (mudar só a âncora da URL não recarrega a página).
async function logout() {
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
}

try {
  await cleanup();
  for (const [account, role, name] of [[OWNER, 'owner', 'Teste Mfa Dona'], [MANAGER, 'manager', 'Teste Mfa Gerente']]) {
    const { error } = await admin.auth.admin.createUser({ email: account.email, password: account.password, email_confirm: true,
      user_metadata: { name }, app_metadata: { roles: [role] } });
    if (error) fail(error.message);
  }

  // 1. Proprietária ativa na própria conta (QR code ou chave) e confirma com o primeiro código.
  await login(OWNER);
  await page.waitForSelector('.avatar-btn');
  await page.click('.avatar-btn');
  await page.waitForSelector('#conta-menu:not([hidden])');
  await clickText('.pop-item', 'Verificação em duas etapas');
  await clickText('dialog[open] button', 'Ativar');
  await page.waitForSelector('dialog[open] .mfa-qr');
  const secret = (await page.$eval('dialog[open] .mfa-secret', (e) => e.textContent)).replace(/\s/g, '');
  await page.type('dialog[open] input[name=code]', '000000');
  await clickText('dialog[open] button', 'Ativar');
  await waitText('Código inválido');
  await page.$eval('dialog[open] input[name=code]', (e) => { e.value = ''; });
  await page.type('dialog[open] input[name=code]', await freshCode(secret));
  await clickText('dialog[open] button', 'Ativar');
  await waitText('Verificação em duas etapas ativada.');
  await waitText('Ativa.');
  ok('Ativação na conta: QR code e chave aparecem; código errado recusado; código do app ativa');

  // 2. Exigir para Proprietária e Gerência (só liga com a sessão verificada, que é o caso agora).
  await page.goto(`${base}/#/configuracoes`, { waitUntil: 'networkidle0' });
  await waitText('Exigir verificação em duas etapas para Proprietária e Gerência');
  await page.evaluate(() => [...document.querySelectorAll('label.check')].find((l) => l.textContent.includes('Exigir verificação'))
    .querySelector('input').click());
  await page.evaluate(() => [...document.querySelectorAll('.panel')].find((p) => p.textContent.includes('Exigir verificação'))
    .querySelector('button[type=submit]').click());
  await waitText('Configuração de segurança salva.');
  const { data: settings } = await admin.from('clinic_settings').select('require_mfa').single();
  if (!settings.require_mfa) fail('exigência não gravada');
  ok('Exigência ligada em Configurações → Segurança');

  // 3. Entrar de novo: depois da senha, pede o código; errado não entra; certo entra.
  await logout();
  await login(OWNER);
  await waitText('Abra o app autenticador');
  await page.type('input[name=code]', '111111');
  await page.click('button[type=submit]');
  await waitText('Código inválido');
  await page.$eval('input[name=code]', (e) => { e.value = ''; });
  await page.type('input[name=code]', await freshCode(secret));
  await page.click('button[type=submit]');
  await page.waitForSelector('.rail-link', { timeout: 15000 });
  ok('Nova entrada da Proprietária: código pedido depois da senha; errado recusado; certo libera o sistema');

  // 4. Gerência sem app cadastrado: só vê a tela de cadastro, e o banco recusa tudo nessa sessão.
  await logout();
  await login(MANAGER);
  await waitText('Ative a verificação em duas etapas');
  await page.waitForSelector('.mfa-qr');
  if (await page.$('.rail-link')) fail('Gerência viu o sistema sem o código');
  const session = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await session.auth.signInWithPassword(MANAGER);
  const { data: access } = await session.rpc('my_access');
  const { error: denied } = await session.rpc('task_counts');
  const { data: patients } = await session.from('patients').select('id').limit(1);
  if (access.mfa !== 'enroll' || access.permissions.length || !denied || patients?.length) {
    fail('banco não bloqueou a Gerência sem código: ' + JSON.stringify({ access, denied: denied?.message, patients }));
  }
  ok('Gerência sem o app: tela de cadastro com QR code; sem permissões no banco (tarefas recusadas, nenhum paciente)');

  // 5. Desligar a exigência devolve o acesso normal.
  await admin.from('clinic_settings').update({ require_mfa: false }).eq('id', true);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.rail-link', { timeout: 15000 });
  ok('Exigência desligada: Gerência volta a entrar só com a senha');

  if (problems.length) fail('erros na página: ' + problems.join(' | '));
  console.log('Sem erros de página');
} catch (error) {
  console.log('✘ Falhou: ' + error.message);
  await page.screenshot({ path: `${process.env.SHOT_DIR}/verificacao-falha.png` }).catch(() => {});
} finally {
  await browser.close();
  await cleanup();
  const { data } = await admin.from('clinic_settings').select('require_mfa').single();
  console.log(`exigência ao final: ${data.require_mfa ? 'LIGADA' : 'desligada'}`);
}
