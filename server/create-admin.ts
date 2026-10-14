import { randomBytes } from 'node:crypto';
import { pool } from './db.mjs';
import { hashPassword } from './auth.mjs';

const [name, email] = process.argv.slice(2);
if (!name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) {
  console.error('Uso: npm run create-admin -- "Nome" email@exemplo.com');
  process.exitCode = 1;
} else {
  const password = randomBytes(18).toString('base64url');
  try {
    await pool.query('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)',
      [name.trim(), email.trim().toLowerCase(), await hashPassword(password), 'admin']);
    console.log(`Conta criada para ${email.trim().toLowerCase()}`);
    console.log(`Senha inicial (mostrada uma única vez): ${password}`);
    console.log('Peça à pessoa para trocar a senha antes de usar dados reais.');
  } catch (error) {
    console.error(error.code === '23505' ? 'Esta conta já existe.' : error.message);
    process.exitCode = 1;
  }
}
await pool.end();
