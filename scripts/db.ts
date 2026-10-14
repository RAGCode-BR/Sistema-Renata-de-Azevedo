// PostgreSQL local para desenvolvimento, sem instalar nada no sistema.
// Uso: npm run db:start | npm run db:stop | npm run db:status
// `npm run db:migrate` aplica as migrações no banco configurado (local ou DATABASE_URL, ex.: Supabase).
//
// Os dados ficam em .data/postgres (ignorado pelo git). O servidor só aceita conexões
// pelo socket em /tmp, da própria conta do Mac, que é o padrão usado por server/db.ts.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyMigrations } from '../server/migrate.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const dataDir = `${root}.data/postgres`;
const logFile = `${root}.data/postgres.log`;
const socketDir = process.env.PGHOST || '/tmp';
const database = process.env.PGDATABASE || 'renata_dev';

const platformPackage = `@embedded-postgres/${process.platform}-${process.arch}`;
let binaries: { initdb: string; pg_ctl: string };
try {
  binaries = await import(platformPackage);
} catch {
  console.error(`PostgreSQL para ${process.platform}-${process.arch} não encontrado. Rode npm install.`);
  process.exit(1);
}

function run(binary: string, args: string[], quiet = false): number {
  const result = spawnSync(binary, args, { stdio: quiet ? 'ignore' : 'inherit' });
  return result.status ?? 1;
}

const running = () => run(binaries.pg_ctl, ['status', '-D', dataDir], true) === 0;

async function prepareDatabase(): Promise<void> {
  const admin = new pg.Client({ host: socketDir, database: 'postgres' });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(database)}`);
  await admin.end();

  const client = new pg.Client({ host: socketDir, database });
  await client.connect();
  await applyMigrations(client);
  await client.end();
}

const command = process.argv[2];

if (command === 'migrate') {
  const { pool } = await import('../server/db.ts');
  const target = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : `${database} (local)`;
  try {
    const applied = await applyMigrations(pool);
    console.log(`Migrações aplicadas em ${target}: ${applied.join(', ')}`);
  } finally {
    await pool.end();
  }
} else if (command === 'start') {
  if (!existsSync(`${dataDir}/PG_VERSION`)) {
    mkdirSync(dataDir, { recursive: true });
    if (run(binaries.initdb, ['-D', dataDir, '-E', 'UTF8', '--auth-local=trust', '--auth-host=scram-sha-256'], true) !== 0) {
      console.error('Não foi possível criar a pasta de dados do PostgreSQL.');
      process.exit(1);
    }
  }
  if (running()) {
    console.log('PostgreSQL já estava ligado.');
  } else {
    const options = `-c listen_addresses='' -c unix_socket_directories=${socketDir} -c unix_socket_permissions=0700`;
    if (run(binaries.pg_ctl, ['start', '-w', '-D', dataDir, '-l', logFile, '-o', options], true) !== 0) {
      console.error(`O PostgreSQL não iniciou. Veja ${logFile}`);
      process.exit(1);
    }
    console.log('PostgreSQL ligado.');
  }
  await prepareDatabase();
  console.log(`Banco ${database} pronto.`);
} else if (command === 'stop') {
  if (!running()) console.log('PostgreSQL já estava desligado.');
  else if (run(binaries.pg_ctl, ['stop', '-w', '-D', dataDir, '-m', 'fast'], true) === 0) console.log('PostgreSQL desligado.');
  else process.exitCode = 1;
} else if (command === 'status') {
  console.log(running() ? `PostgreSQL ligado (dados em ${dataDir}).` : 'PostgreSQL desligado.');
} else {
  console.error('Uso: node scripts/db.ts start | stop | status | migrate');
  process.exitCode = 1;
}
