import { readFileSync } from 'node:fs';
import pg from 'pg';
import type { PoolClient, PoolConfig } from 'pg';

// Banco externo (ex.: Supabase) via DATABASE_URL; sem ela, o PostgreSQL local de `npm run db:start`.
// Fora da própria máquina, a conexão precisa de SSL verificado: DATABASE_CA_CERT aponta para o
// certificado do provedor (o Supabase o fornece em Database Settings → SSL Configuration).
function remoteOptions(databaseUrl: string): PoolConfig {
  const url = new URL(databaseUrl);
  const caPath = process.env.DATABASE_CA_CERT;
  if (caPath) {
    // Um sslmode na URL substituiria estas opções, então o certificado tem prioridade.
    url.searchParams.delete('sslmode');
    return { connectionString: url.toString(), ssl: { ca: readFileSync(caPath, 'utf8'), rejectUnauthorized: true } };
  }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  if (!local && !url.searchParams.has('sslmode')) {
    throw new Error('DATABASE_URL aponta para outro servidor: defina DATABASE_CA_CERT (ou sslmode na URL) para usar SSL.');
  }
  return { connectionString: databaseUrl };
}

const options: PoolConfig = process.env.DATABASE_URL
  ? remoteOptions(process.env.DATABASE_URL)
  : { database: process.env.PGDATABASE || 'renata_dev', host: process.env.PGHOST || '/tmp' };

export const pool = new pg.Pool({ ...options, max: 10 });

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Código de um erro do PostgreSQL (ex.: '23505', registro duplicado) ou do sistema (ex.: 'ENOENT').
export function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}
