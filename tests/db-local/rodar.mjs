// Banco local descartável: aplica todas as migrações num Postgres temporário (sem Docker) e roda os testes
// de banco. Serve para testar uma migração nova ANTES de aplicá-la no Supabase.
// Uso (dentro de tests/): npm run test:banco-local
// supabase-stub.sql imita o que o Supabase já traz (auth, storage, papéis anon/authenticated/service_role).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUPABASE = path.resolve(HERE, '..', '..', 'supabase');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'banco-local-'));
const port = 54330 + Math.floor(Math.random() * 500);
const server = new EmbeddedPostgres({ databaseDir: dir, port, user: 'postgres', password: 'local', persistent: false, onLog: () => {} });

let failed = false;
const connect = async () => { const c = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'local', database: 'postgres' }); await c.connect(); return c; };

// Dois registros de pagamento ao mesmo tempo para a mesma cobrança (ex.: dois cliques, ou app e computador):
// a cobrança não pode receber mais do que vale; a sobra vira crédito do paciente.
async function concurrentPayments() {
  const setup = await connect();
  await setup.query(`
    INSERT INTO public.professionals (id, name) VALUES ('00000000-0000-4000-8000-00000000cc01', 'Prof Concorrência');
    INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
      ('00000000-0000-4000-8000-00000000cc02', 'fin-concorrencia@example.test', '{"roles":["finance"]}', '{"name":"Fin"}');
    INSERT INTO public.patients (id, name) VALUES ('00000000-0000-4000-8000-00000000cc03', 'Paciente Concorrência');
    INSERT INTO public.charges (id, patient_id, description, competence_date, due_date, amount)
    VALUES ('00000000-0000-4000-8000-00000000cc04', '00000000-0000-4000-8000-00000000cc03', 'Sessão', current_date, current_date, 100);`);
  const pay = async () => {
    const c = await connect();
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000cc02","role":"authenticated"}', true)`);
    return c;
  };
  const [a, b] = [await pay(), await pay()];
  const call = (c) => c.query(`SELECT public.register_payment('00000000-0000-4000-8000-00000000cc03', 100, 'pix', (now() AT TIME ZONE 'America/Sao_Paulo')::date, ARRAY['00000000-0000-4000-8000-00000000cc04']::uuid[], NULL)`);
  await call(a);
  const second = call(b).then(() => b.query('COMMIT'), async (error) => { await b.query('ROLLBACK'); return error; });
  await new Promise((r) => setTimeout(r, 300)); // a segunda fica esperando a trava da primeira
  await a.query('COMMIT');
  const outcome = await second;
  await a.end(); await b.end();
  const { rows: [r] } = await setup.query(`SELECT
    (SELECT coalesce(sum(amount), 0) FROM public.payment_allocations WHERE charge_id = '00000000-0000-4000-8000-00000000cc04')::numeric AS allocated,
    private.patient_credit('00000000-0000-4000-8000-00000000cc03') AS credit`);
  await setup.end();
  if (Number(r.allocated) !== 100) throw new Error(`a cobrança de R$ 100 recebeu R$ ${r.allocated}`);
  console.log(`✔ pagamentos simultâneos: a cobrança recebeu só R$ 100; ${outcome instanceof Error ? 'o segundo foi recusado' : `o segundo virou crédito (R$ ${r.credit})`}`);
}
try {
  await server.initialise();
  await server.start();
  const client = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'local', database: 'postgres' });
  await client.connect();
  await client.query(fs.readFileSync(path.join(HERE, 'supabase-stub.sql'), 'utf8'));

  const migrations = fs.readdirSync(path.join(SUPABASE, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const [index, file] of migrations.entries()) {
    // As contas que já existiam quando os perfis foram criados (a 3ª migração as converte).
    if (index === 2) {
      await client.query(`INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data) VALUES
        ('11111111-1111-4111-8111-111111111111', 'dona@example.test', '{"role":"admin"}', '{"name":"Dona"}'),
        ('22222222-2222-4222-8222-222222222222', 'gerente@example.test', '{"role":"admin"}', '{"name":"Gerente"}')`);
    }
    await client.query(fs.readFileSync(path.join(SUPABASE, 'migrations', file), 'utf8'))
      .catch((error) => { throw new Error(`${file}: ${error.message}`); });
  }
  console.log(`✔ ${migrations.length} migrações aplicadas`);

  await client.end();
  await concurrentPayments().catch((error) => { failed = true; console.log('✘ pagamentos simultâneos: ' + error.message); });
  // Uma conexão por arquivo, como no Supabase (configurações da sessão não passam de um teste para outro).
  for (const file of ['permissions.sql', 'seguranca.sql', 'financeiro.sql']) {
    const session = new pg.Client({ host: 'localhost', port, user: 'postgres', password: 'local', database: 'postgres' });
    await session.connect();
    const result = await session.query(fs.readFileSync(path.join(SUPABASE, 'tests', file), 'utf8'))
      .catch((error) => ({ error }));
    await session.end();
    if (result.error) { failed = true; console.log(`✘ ${file}: ${result.error.message}${result.error.where ? ` (${result.error.where.split('\n')[0]})` : ''}`); continue; }
    const last = [].concat(result).filter((r) => r.rows?.length).pop();
    console.log(`✔ ${file}: ${last?.rows?.[0]?.resultado ?? 'ok'}`);
  }
} catch (error) {
  failed = true;
  console.log('✘ ' + error.message);
} finally {
  await server.stop().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
