// Roda os testes automáticos contra o projeto Supabase configurado no .env da raiz.
// Uso (dentro de tests/): npm install && node run.mjs [nomes...] [--sem-app] [--sem-integracao]
//   ex.: node run.mjs              → banco + todas as telas + app + integrações
//        node run.mjs agenda portal → só esses roteiros
// Cada roteiro cria os próprios dados de teste (contas @example.test, pacientes "… E2E") e a limpeza roda
// depois de cada um. Os roteiros entram com uma conta de teste de Proprietária criada aqui (nunca com a
// conta de uma pessoa real). A chave de serviço vem da CLI do Supabase e nunca é impressa.
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(HERE, '..');
const { createClient } = createRequire(path.join(PROJECT_DIR, 'package.json'))('@supabase/supabase-js');

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith('--'));
const flag = (name) => args.includes(name);

// Configuração ---------------------------------------------------------------------------------

function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n')
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^['"]|['"]$/g, '')]));
}
const dotenv = readEnv(path.join(PROJECT_DIR, '.env'));
const SUPABASE_URL = process.env.SUPABASE_URL ?? dotenv.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? dotenv.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env da raiz.');
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const CHROME_PATH = process.env.CHROME_PATH ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : '/usr/bin/google-chrome');
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173';
const APP_URL = 'http://localhost:8090';
const SHOT_DIR = path.join(HERE, '.saida');
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'testes-clinica-'));
const FIXTURES_DIR = path.join(HERE, 'fixtures');
const DENO_BIN = path.join(HERE, 'node_modules', '.bin', 'deno');
fs.mkdirSync(SHOT_DIR, { recursive: true });

function serviceKey() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', PROJECT_REF, '-o', 'json'],
    { cwd: PROJECT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const key = JSON.parse(out).find((item) => item.name === 'service_role')?.api_key;
  if (!key) throw new Error('Não foi possível obter a chave de serviço (rode "npx supabase login").');
  return key;
}
const SUPABASE_SERVICE_ROLE_KEY = serviceKey();
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Conta de teste da Proprietária (recriada antes de cada roteiro, pois a limpeza apaga as contas @example.test).
const OWNER = { email: 'teste-orquestra-dona@example.test', password: `Teste-${crypto.randomBytes(9).toString('base64url')}`, name: 'Dona Orquestra' };
async function ensureOwner() {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (data.users.some((user) => user.email === OWNER.email)) return;
  const { error } = await admin.auth.admin.createUser({
    email: OWNER.email, password: OWNER.password, email_confirm: true,
    user_metadata: { name: OWNER.name }, app_metadata: { roles: ['owner'] }
  });
  if (error) throw new Error('Conta de teste: ' + error.message);
}

// Banco e arquivos -------------------------------------------------------------------------------

const START = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '+00');
function sql(file) {
  return execFileSync('npx', ['supabase', 'db', 'query', '--linked', '-f', file], { cwd: PROJECT_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function sqlText(text) {
  const file = path.join(WORK_DIR, `q-${crypto.randomUUID()}.sql`);
  fs.writeFileSync(file, text);
  try { return sql(file); } finally { fs.rmSync(file, { force: true }); }
}
const rows = (output) => { try { return JSON.parse(output.slice(output.indexOf('{'))).rows ?? []; } catch { return []; } };

// Arquivos cuja pasta de paciente não existe mais (o storage não apaga junto com o banco).
async function cleanFiles() {
  const orphans = rows(sqlText(`SELECT bucket_id, name FROM storage.objects
    WHERE (bucket_id IN ('patient-documents', 'clinical-documents', 'portal-documents')
      AND split_part(name, '/', 2) NOT IN (SELECT id::text FROM public.patients))
      OR (bucket_id = 'professional-files'
      AND split_part(name, '/', 2) NOT IN (SELECT id::text FROM public.professionals))`));
  for (const bucket of new Set(orphans.map((o) => o.bucket_id))) {
    await admin.storage.from(bucket).remove(orphans.filter((o) => o.bucket_id === bucket).map((o) => o.name));
  }
  return orphans.length;
}
async function cleanup() {
  sqlText(fs.readFileSync(path.join(HERE, 'db', 'limpeza.sql'), 'utf8').replaceAll('{{INICIO}}', START));
  await cleanFiles();
}

// Servidores locais ------------------------------------------------------------------------------

const children = [];
const reachable = (url) => fetch(url).then(() => true, () => false);
async function waitFor(url, seconds = 90) {
  for (let i = 0; i < seconds * 2; i++) { if (await reachable(url)) return; await new Promise((r) => setTimeout(r, 500)); }
  throw new Error('Não respondeu: ' + url);
}
async function startWeb() {
  if (await reachable(BASE_URL)) return;
  children.push(spawn('npm', ['run', 'dev', '--', '--port', new URL(BASE_URL).port || '5173', '--strictPort'], { cwd: PROJECT_DIR, stdio: 'ignore', detached: true }));
  await waitFor(BASE_URL);
}
let appServer;
async function startApp() {
  if (appServer) return;
  execFileSync('npx', ['expo', 'export', '--platform', 'web'], { cwd: path.join(PROJECT_DIR, 'mobile'), env: { ...process.env, CI: '1' }, stdio: 'ignore' });
  const root = path.join(PROJECT_DIR, 'mobile', 'dist');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };
  appServer = http.createServer((req, res) => {
    let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  }).listen(Number(new URL(APP_URL).port));
}

// Roteiros ---------------------------------------------------------------------------------------

const web = (name, file, extra = {}) => ({ name, kind: 'tela', file: `e2e/${file}`, ...extra });
const SUITES = [
  { name: 'banco', kind: 'banco' },
  web('geral', '00-geral.mjs', { shotArg: true }),
  web('usuarios', '01-usuarios.mjs'),
  web('painel', '02-painel.mjs'),
  web('agenda', '03-agenda.mjs'),
  web('pacientes', '04-pacientes.mjs'),
  web('prontuario', '05-prontuario.mjs'),
  web('financeiro', '06-financeiro.mjs'),
  web('comercial', '08-comercial.mjs'),
  web('relatorios', '09-relatorios.mjs', { seed: 'db/seed-relatorios.sql' }),
  { name: 'app', kind: 'app', file: 'e2e/12-app-equipe.mjs' },
  web('portal', '13-portal.mjs'),
  web('verificacao', '14-verificacao.mjs'),
  { name: 'funcoes', kind: 'integracao', file: 'integracao/funcoes-publicadas.mjs' },
  { name: 'integracao-google', kind: 'integracao', file: 'integracao/google.mjs' },
  { name: 'integracao-whatsapp', kind: 'integracao', file: 'integracao/whatsapp.mjs' },
  { name: 'integracao-ia', kind: 'integracao', file: 'integracao/ia.mjs' },
  { name: 'integracao-portal', kind: 'integracao', file: 'integracao/portal.mjs' }
].filter((suite) => (only.length ? only.some((name) => suite.name.includes(name)) : true)
  && !(flag('--sem-app') && suite.kind === 'app') && !(flag('--sem-integracao') && suite.kind === 'integracao'));

const ENV = {
  ...process.env, PROJECT_DIR, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, CHROME_PATH, SHOT_DIR, WORK_DIR,
  FIXTURES_DIR, DENO_BIN, OWNER_EMAIL: OWNER.email, OWNER_PASSWORD: OWNER.password, OWNER_FIRST_NAME: OWNER.name.split(' ')[0], OWNER_NAME: OWNER.name,
  CSV_FILE: path.join(FIXTURES_DIR, 'leads-e2e.csv'), FILE: path.join(FIXTURES_DIR, 'declaracao-teste.pdf'), NO_COLOR: '1'
};

function run(command, commandArgs, options) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => { output += d; if (process.env.VERBOSE) process.stdout.write(d); });
    child.stderr.on('data', (d) => { output += d; if (process.env.VERBOSE) process.stderr.write(d); });
    child.on('close', (code) => resolve({ code, output }));
  });
}

// Com a verificação em duas etapas exigida, a conta de teste da Proprietária não entra sem o código.
const needsOwner = SUITES.some((suite) => suite.kind === 'tela' || suite.kind === 'app');
if (needsOwner && rows(sqlText('SELECT require_mfa FROM public.clinic_settings'))[0]?.require_mfa) {
  console.log('A verificação em duas etapas está EXIGIDA (Configurações → Segurança). Os roteiros de tela entram como\n'
    + 'Proprietária de teste e não passariam. Desligue temporariamente ou rode só: node run.mjs banco funcoes');
  process.exit(1);
}

const results = [];
try {
  for (const suite of SUITES) {
    process.stdout.write(`• ${suite.name}… `);
    let outcome;
    if (suite.kind === 'banco') {
      const parts = ['permissions.sql', 'seguranca.sql', 'financeiro.sql', 'atividades_pacientes.sql'].map((file) => {
        try { return rows(sql(path.join('supabase', 'tests', file)))[0]?.resultado ?? 'sem resultado'; } catch (error) { return 'FALHA: ' + String(error.stderr ?? error.message).match(/FALHA[^"\n]*|ERROR[^"\n]*/)?.[0]; }
      });
      outcome = { passed: parts.filter((p) => p.includes('passaram')).length, failed: parts.filter((p) => !p.includes('passaram')), detail: parts };
    } else {
      if (suite.kind === 'tela') await startWeb();
      if (suite.kind === 'app') await startApp();
      await ensureOwner();
      // Configurações reais da clínica: guardadas antes e devolvidas depois, mesmo se o roteiro falhar no meio.
      const { data: settings } = await admin.from('clinic_settings').select('*').single();
      const { data: crm } = await admin.from('crm_settings').select('*').single();
      if (suite.seed) sql(path.join('tests', suite.seed));
      const base = suite.kind === 'app' ? APP_URL : BASE_URL;
      const scriptArgs = suite.kind === 'integracao' ? [] : [base, OWNER.email, OWNER.password, ...(suite.shotArg || suite.kind === 'app' ? [SHOT_DIR] : [])];
      const { code, output } = await run(process.execPath, [path.join(HERE, suite.file), ...scriptArgs], { cwd: HERE, env: ENV });
      fs.writeFileSync(path.join(SHOT_DIR, `${suite.name}.log`), output);
      const passed = (output.match(/^✔/gm) ?? []).length;
      const failed = output.split('\n').filter((line) => /^(✘|✖)|FALHA|Falhou/.test(line));
      if (code !== 0 && !failed.length) failed.push(`saiu com código ${code}`);
      outcome = { passed, failed };
      if (settings) await admin.from('clinic_settings').update(settings).eq('id', true);
      if (crm) await admin.from('crm_settings').update(crm).eq('id', crm.id);
      await cleanup();
    }
    results.push({ name: suite.name, ...outcome });
    console.log(outcome.failed.length ? `FALHOU (${outcome.passed} ok) — ${outcome.failed.join(' | ').slice(0, 300)}` : `${outcome.passed} ok`);
  }
} finally {
  await cleanup().catch((error) => console.log('limpeza: ' + error.message));
  const left = rows(sqlText(`SELECT (SELECT count(*) FROM auth.users WHERE email LIKE '%@example.test') AS contas,
    (SELECT count(*) FROM public.patients WHERE name LIKE '%E2E' OR name LIKE 'Paciente %' AND email LIKE '%@example.test') AS pacientes`))[0];
  console.log(`\nDados de teste restantes: ${left?.contas ?? '?'} conta(s), ${left?.pacientes ?? '?'} paciente(s). Registros e capturas em tests/.saida/`);
  children.forEach((child) => { try { process.kill(-child.pid); } catch { /* já encerrado */ } });
  appServer?.close();
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
}
const failures = results.filter((r) => r.failed.length);
console.log(failures.length ? `${failures.length} roteiro(s) com falha: ${failures.map((f) => f.name).join(', ')}` : 'Todos os roteiros passaram.');
process.exit(failures.length ? 1 : 0);
