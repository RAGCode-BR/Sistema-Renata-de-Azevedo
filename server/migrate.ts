import { readdir, readFile } from 'node:fs/promises';

const dir = new URL('../db/', import.meta.url);

// Aplica db/*.sql em ordem. As migrações são idempotentes (IF NOT EXISTS), então podem ser reaplicadas.
export async function applyMigrations(client: { query: (sql: string) => Promise<unknown> }): Promise<string[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith('.sql')).sort();
  for (const name of names) await client.query(await readFile(new URL(name, dir), 'utf8'));
  return names;
}
