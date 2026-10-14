import { randomBytes } from 'node:crypto';
import { pool, errorCode } from './db.ts';
import { hashPassword } from './auth.ts';

// A senha pode vir de ADMIN_PASSWORD (e não de um argumento, que ficaria visível na lista de processos).
// Sem ela, uma senha aleatória é gerada e mostrada uma única vez.
const [name, email] = process.argv.slice(2);
const chosenPassword = process.env.ADMIN_PASSWORD;
if (!name?.trim() || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Uso: npm run create-admin -- "Nome" email@exemplo.com');
  console.error('Para definir a senha: ADMIN_PASSWORD="..." npm run create-admin -- "Nome" email@exemplo.com');
  process.exitCode = 1;
} else {
  const password = chosenPassword || randomBytes(18).toString('base64url');
  try {
    await pool.query('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)',
      [name.trim(), email.trim().toLowerCase(), await hashPassword(password), 'admin']);
    console.log(`Conta criada para ${email.trim().toLowerCase()}`);
    if (!chosenPassword) {
      console.log(`Senha inicial (mostrada uma única vez): ${password}`);
      console.log('Peça à pessoa para trocar a senha antes de usar dados reais.');
    }
  } catch (error) {
    console.error(errorCode(error) === '23505' ? 'Esta conta já existe.' : (error as Error).message);
    process.exitCode = 1;
  }
}
await pool.end();
