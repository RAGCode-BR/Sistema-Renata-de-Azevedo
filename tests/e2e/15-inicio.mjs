// Início: indicadores dos pacientes de hoje e fluxo de caixa (dia, semana, mês, ano).
// Rodado por tests/run.mjs. Os valores esperados vêm do próprio banco (somando o que já existir de real no
// período), então o roteiro funciona com dados reais da clínica. Apaga tudo o que criou, mesmo se falhar.
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const { createClient } = createRequire(`${process.env.PROJECT_DIR}/package.json`)('@supabase/supabase-js');
const [base, ownerEmail, ownerPassword] = process.argv.slice(2);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const MANAGER = { email: 'teste-inicio-gerente@example.test', password: `Inicio-${crypto.randomBytes(8).toString('hex')}` };
const ids = { patients: [], appointments: [], professional: null, payment: null, expense: null };
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const fail = (m) => { throw new Error(m); };
const must = async (q, label) => { const r = await q; if (r.error) throw new Error(label + ': ' + r.error.message); return r; };
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (v) => BRL.format(v).replace(/ /g, ' ');
const pad = (v) => String(v).padStart(2, '0');
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
const todayKey = key(today);

async function cleanup() {
  if (ids.payment) { await admin.from('payment_allocations').delete().eq('payment_id', ids.payment); await admin.from('payments').delete().eq('id', ids.payment); }
  if (ids.expense) await admin.from('expenses').delete().eq('id', ids.expense);
  if (ids.appointments.length) {
    await admin.from('charges').delete().in('appointment_id', ids.appointments);
    await admin.from('appointment_events').delete().in('appointment_id', ids.appointments);
    await admin.from('appointments').delete().in('id', ids.appointments);
  }
  if (ids.patients.length) {
    await admin.from('charges').delete().in('patient_id', ids.patients);
    await admin.from('patient_professionals').delete().in('patient_id', ids.patients);
    await admin.from('patients').delete().in('id', ids.patients);
  }
  if (ids.professional) await admin.from('professionals').delete().eq('id', ids.professional);
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users.filter((u) => u.email === MANAGER.email)) await admin.auth.admin.deleteUser(user.id);
}

// Soma do banco para o período (mesma conta do sistema).
async function cashTotals(from, to) {
  const sum = (rows) => (rows ?? []).reduce((total, row) => total + Number(row.amount), 0);
  const { data: payments } = await admin.from('payments').select('amount').is('reversed_at', null).gte('received_at', from).lte('received_at', to);
  const { data: expenses } = await admin.from('expenses').select('amount').gte('paid_at', from).lte('paid_at', to);
  const { data: payouts } = await admin.from('payouts').select('amount').gte('paid_at', from).lte('paid_at', to);
  const received = sum(payments);
  const out = sum(expenses) + sum(payouts);
  return { received, out, balance: received - out };
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true });
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
await page.setViewport({ width: 1280, height: 900 });
const main = () => page.evaluate(() => document.querySelector('main').innerText.replace(/ /g, ' '));
const waitMain = (text, timeout = 15000) => page.waitForFunction((t) => document.querySelector('main')?.innerText.replace(/ /g, ' ').includes(t), { timeout, polling: 200 }, text);
const tile = (section, key) => page.evaluate((s, k) => document.querySelector(`${s} [data-kpi="${k}"] .kpi-value`)?.textContent.trim() ?? null, section, key);
const clickTab = async (label) => {
  await page.evaluate((l) => [...document.querySelectorAll('[aria-label="Período do fluxo de caixa"] .tab')].find((b) => b.textContent.trim() === l).click(), label);
};
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

try {
  await cleanup();
  // Linha de base: sessões de hoje que já existirem (dados reais) entram nos números esperados.
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  const { data: before } = await admin.from('appointments').select('patient_id, status').gte('starts_at', dayStart.toISOString()).lt('starts_at', dayEnd.toISOString());

  // Cenário: 6 pacientes com sessões hoje em situações diferentes, um pagamento e uma despesa paga hoje.
  const { data: prof } = await must(admin.from('professionals').insert({ name: 'Teste Inicio Prof' }).select('id').single(), 'profissional');
  ids.professional = prof.id;
  const statuses = ['confirmed', 'scheduled', 'awaiting_confirmation', 'completed', 'missed', 'cancelled_by_patient'];
  for (const [index, status] of statuses.entries()) {
    const { data: patient } = await must(admin.from('patients').insert({ name: `Paciente Inicio E2E ${index + 1}` }).select('id').single(), 'paciente');
    ids.patients.push(patient.id);
    await must(admin.from('patient_professionals').insert({ patient_id: patient.id, professional_id: prof.id }), 'vínculo');
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 7 + index * 2, 0);
    const { data: appt } = await must(admin.from('appointments').insert({ patient_id: patient.id, professional_id: prof.id,
      starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 50 * 60000).toISOString(), status: 'scheduled' }).select('id').single(), 'sessão');
    ids.appointments.push(appt.id);
    if (status !== 'scheduled') await must(admin.from('appointments').update({ status }).eq('id', appt.id), 'situação');
  }
  const { data: payment } = await must(admin.from('payments').insert({ patient_id: ids.patients[0], amount: 350, method: 'pix', received_at: todayKey }).select('id').single(), 'pagamento');
  ids.payment = payment.id;
  const { data: category } = await admin.from('finance_categories').select('id').limit(1).single();
  const { data: center } = await admin.from('cost_centers').select('id').limit(1).single();
  const { data: expense } = await must(admin.from('expenses').insert({ description: 'Despesa Inicio E2E', category_id: category.id, cost_center_id: center.id,
    amount: 120, competence_date: todayKey, due_date: todayKey, paid_at: todayKey, method: 'pix' }).select('id').single(), 'despesa');
  ids.expense = expense.id;

  const all = [...(before ?? []), ...statuses.map((status, i) => ({ status, patient_id: ids.patients[i] }))];
  const occupies = (s) => !['cancelled_by_patient', 'cancelled_by_clinic', 'rescheduled'].includes(s);
  const expected = {
    patients: new Set(all.filter((a) => occupies(a.status)).map((a) => a.patient_id)).size,
    confirmed: all.filter((a) => a.status === 'confirmed').length,
    pending: all.filter((a) => ['scheduled', 'awaiting_confirmation'].includes(a.status)).length,
    completed: all.filter((a) => a.status === 'completed').length,
    missed: all.filter((a) => a.status === 'missed').length,
    cancelled: all.filter((a) => ['cancelled_by_patient', 'cancelled_by_clinic'].includes(a.status)).length
  };

  // 1. Proprietária: indicadores dos pacientes de hoje.
  await login(ownerEmail, ownerPassword);
  await page.waitForSelector('.today-patients');
  await page.waitForFunction(() => !document.querySelector('.today-patients[aria-busy="true"]'), { timeout: 15000 });
  for (const [label, value] of Object.entries(expected)) {
    const shown = await tile('.today-patients', label);
    if (shown !== String(value)) fail(`indicador "${label}": esperado ${value}, na tela ${shown}`);
  }
  ok(`Pacientes de hoje: ${Object.entries(expected).map(([l, v]) => `${v} ${l}`).join(', ')}`);

  // 2. Fluxo de caixa: mês (padrão), dia, semana e ano batem com o banco.
  await waitMain('Fluxo de caixa');
  const check = async (label, from, to) => {
    const t = await cashTotals(from, to);
    await page.waitForFunction((v) => [...document.querySelectorAll('.cash-flow-numbers .number strong')]
      .map((e) => e.textContent.replace(/ /g, ' ')).join('|') === v, { timeout: 15000, polling: 200 },
      [money(t.received), money(t.out), money(t.balance)].join('|'))
      .catch(async () => fail(`${label}: esperado ${money(t.received)} / ${money(t.out)} / ${money(t.balance)}, na tela ${await page.evaluate(() =>
        [...document.querySelectorAll('.cash-flow-numbers .number strong')].map((e) => e.textContent).join(' / '))}`));
    return t;
  };
  const monthFrom = key(new Date(today.getFullYear(), today.getMonth(), 1));
  const monthTo = key(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const month = await check('Mês', monthFrom, monthTo);
  await clickTab('Dia');
  const day = await check('Dia', todayKey, todayKey);
  if (await page.$('.cash-flow svg')) fail('gráfico no período de um dia');
  await clickTab('Semana');
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  await check('Semana', key(monday), key(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)));
  await page.waitForSelector('.cash-flow svg');
  await clickTab('Ano');
  await check('Ano', `${today.getFullYear()}-01-01`, `${today.getFullYear()}-12-31`);
  if (day.received < 350 || day.out < 120) fail('pagamento ou despesa de hoje fora do fluxo do dia');
  ok(`Fluxo de caixa: dia ${money(day.balance)}, mês ${money(month.balance)}; semana e ano com gráfico; dia sem gráfico; valores iguais ao banco`);

  // 3. Navegação: ano anterior e volta para hoje.
  await page.evaluate(() => document.querySelector('[aria-label="Período anterior"]').click());
  await waitMain(String(today.getFullYear() - 1));
  await check('Ano anterior', `${today.getFullYear() - 1}-01-01`, `${today.getFullYear() - 1}-12-31`);
  await page.evaluate(() => [...document.querySelectorAll('.cash-flow-pager button')].find((b) => b.textContent.trim() === 'Hoje').click());
  await waitMain(String(today.getFullYear()));
  ok('Navegação: ‹ vai ao ano anterior (valores do banco) e "Hoje" volta ao período atual');

  // 4. Celular: sem rolagem lateral.
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.cash-flow-numbers');
  await new Promise((r) => setTimeout(r, 800));
  if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) fail('rolagem lateral no celular');
  await page.screenshot({ path: `${process.env.SHOT_DIR}/inicio-celular.png`, fullPage: true });
  await page.setViewport({ width: 1280, height: 900 });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.cash-flow-numbers');
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: `${process.env.SHOT_DIR}/inicio.png`, fullPage: true });
  ok('Celular (390 px): indicadores e fluxo de caixa sem rolagem lateral');

  // 5. Gerência (sem permissão financeira): vê os pacientes de hoje, não vê o fluxo de caixa.
  await must(admin.auth.admin.createUser({ email: MANAGER.email, password: MANAGER.password, email_confirm: true,
    user_metadata: { name: 'Teste Inicio Gerente' }, app_metadata: { roles: ['manager'] } }), 'gerente');
  await login(MANAGER.email, MANAGER.password);
  await page.waitForSelector('.today-patients');
  await new Promise((r) => setTimeout(r, 1500));
  if ((await main()).includes('Fluxo de caixa')) fail('Gerência viu o fluxo de caixa');
  ok('Gerência: indicadores de hoje, sem o fluxo de caixa');

  if (problems.length) fail('erros na página: ' + problems.join(' | '));
  console.log('Sem erros de página');
} catch (error) {
  console.log('✘ Falhou: ' + error.message);
  console.log('  em ' + (error.stack ?? '').split('\n').filter((l) => l.includes('/e2e/')).map((l) => l.trim().replace(/^.*\/e2e\//, '')).join(' ← '));
  await page.screenshot({ path: `${process.env.SHOT_DIR}/inicio-falha.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  await cleanup();
}
