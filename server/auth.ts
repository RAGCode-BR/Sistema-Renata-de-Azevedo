import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { promisify } from 'node:util';
import { pool } from './db.ts';
import { MIN_PASSWORD_LENGTH } from '../shared/rules.ts';
import type { SessionUser } from '../shared/types.ts';

export type { Role, SessionUser } from '../shared/types.ts';

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SESSION_DAYS = 14;

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, saltValue, hashValue] = String(encoded).split(':');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, 'base64url');
  const actual = await scrypt(password, Buffer.from(saltValue, 'base64url'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionCookie(token: string, request: IncomingMessage): string {
  const secure = (request.socket as TLSSocket).encrypted || (process.env.TRUST_PROXY === '1' && request.headers['x-forwarded-proto'] === 'https');
  return `rda_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie(request: IncomingMessage): string {
  return sessionCookie('', request).replace(/Max-Age=\d+/, 'Max-Age=0');
}

function cookieToken(request: IncomingMessage): string {
  const raw = request.headers.cookie || '';
  return raw.split(';').map((part) => part.trim()).find((part) => part.startsWith('rda_session='))?.slice(12) || '';
}

export async function currentUser(request: IncomingMessage): Promise<SessionUser | null> {
  const token = cookieToken(request);
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const { rows } = await pool.query<SessionUser>(`
    SELECT u.id, u.name, u.email, u.role, u.professional_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active
  `, [tokenHash(token)]);
  return rows[0] || null;
}

export async function createSession(userId: string, request: IncomingMessage): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES ($1, $2, now() + interval '14 days')`, [tokenHash(token), userId]);
  return sessionCookie(token, request);
}

export async function deleteSession(request: IncomingMessage): Promise<void> {
  const token = cookieToken(request);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
}
