import pg from 'pg';

const options = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : { database: process.env.PGDATABASE || 'renata_dev', host: process.env.PGHOST || '/tmp' };

export const pool = new pg.Pool({ ...options, max: 10 });

export async function transaction(work) {
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
