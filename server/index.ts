import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pool, transaction } from './db.mjs';
import { hashPassword, verifyPassword, currentUser, createSession, deleteSession, clearSessionCookie } from './auth.mjs';

const root = new URL('../', import.meta.url);
const port = Number(process.env.PORT || 8787);
const failedLogins = new Map();

function reply(response, status, data, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  response.end(JSON.stringify(data));
}

function problem(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireRole(user, role) {
  if (!user) throw problem(401, 'Entre na sua conta para continuar.');
  if (role && user.role !== role) throw problem(403, 'Você não tem acesso a esta área.');
}

async function bodyOf(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 1024 * 1024) throw problem(413, 'Envie um arquivo menor.');
  }
  try { return JSON.parse(text || '{}'); }
  catch { throw problem(400, 'JSON inválido.'); }
}

function string(value, max = 255) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function uuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function emailOf(value) {
  const email = string(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw problem(400, 'Informe um e-mail válido.');
  return email;
}

function requireUuid(value, label) {
  if (!uuid(value)) throw problem(400, `${label} inválido.`);
  return value;
}

function dateOf(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw problem(400, `${label} inválida.`);
  return date.toISOString();
}

async function audit(client, user, action, entityType, entityId) {
  await client.query('INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id) VALUES ($1,$2,$3,$4)',
    [user.id, action, entityType, entityId]);
}

async function serveFile(response, relativePath, contentType) {
  const content = await readFile(new URL(relativePath, root));
  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
  });
  response.end(content);
}

async function handle(request, response) {
  const url = new URL(request.url, `http://localhost:${port}`);
  const path = url.pathname;
  const method = request.method;

  if (method === 'GET' && path === '/') return serveFile(response, 'system/index.html', 'text/html; charset=utf-8');
  if (method === 'GET' && path === '/app.js') return serveFile(response, 'system/app.js', 'text/javascript; charset=utf-8');
  if (method === 'GET' && path === '/style.css') return serveFile(response, 'system/style.css', 'text/css; charset=utf-8');
  if (method === 'GET' && path === '/logo.png') return serveFile(response, 'assets/logo.png', 'image/png');
  if (!path.startsWith('/api/')) return reply(response, 404, { error: 'Página não encontrada.' });

  if (!['GET', 'HEAD'].includes(method)) {
    if (request.headers['x-requested-with'] !== 'clinic-local') throw problem(403, 'Requisição não permitida.');
    const origin = request.headers.origin;
    if (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin)) {
      throw problem(403, 'Origem não permitida.');
    }
  }

  if (method === 'POST' && path === '/api/session') {
    const input = await bodyOf(request);
    const email = emailOf(input.email);
    const key = `${request.socket.remoteAddress}:${email}`;
    const attempts = (failedLogins.get(key) || []).filter((at) => Date.now() - at < 15 * 60_000);
    if (attempts.length >= 5) throw problem(429, 'Muitas tentativas. Aguarde 15 minutos.');
    const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = $1 AND active', [email]);
    if (!rows[0] || !await verifyPassword(String(input.password || ''), rows[0].password_hash)) {
      failedLogins.set(key, [...attempts, Date.now()]);
      throw problem(401, 'E-mail ou senha inválidos.');
    }
    failedLogins.delete(key);
    const cookie = await createSession(rows[0].id, request);
    return reply(response, 200, { id: rows[0].id, name: rows[0].name, role: rows[0].role }, { 'Set-Cookie': cookie });
  }

  const user = await currentUser(request);
  if (method === 'GET' && path === '/api/session') {
    return reply(response, 200, { user });
  }
  if (method === 'DELETE' && path === '/api/session') {
    if (user) await deleteSession(request);
    return reply(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(request) });
  }
  requireRole(user);

  if (method === 'PATCH' && path === '/api/me/password') {
    const input = await bodyOf(request);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [user.id]);
    if (!await verifyPassword(String(input.currentPassword || ''), rows[0].password_hash)) {
      throw problem(403, 'Senha atual incorreta.');
    }
    if (typeof input.newPassword !== 'string' || input.newPassword.length < 12) {
      throw problem(400, 'A nova senha precisa ter pelo menos 12 caracteres.');
    }
    const newHash = await hashPassword(input.newPassword);
    await transaction(async (client) => {
      await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [newHash, user.id]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
      await audit(client, user, 'change_password', 'user', user.id);
    });
    const cookie = await createSession(user.id, request);
    return reply(response, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  if (method === 'GET' && path === '/api/professionals') {
    const { rows } = await pool.query('SELECT id, name, email, active FROM professionals ORDER BY name');
    return reply(response, 200, { items: rows });
  }
  if (method === 'POST' && path === '/api/professionals') {
    requireRole(user, 'admin');
    const input = await bodyOf(request);
    const name = string(input.name);
    if (!name) throw problem(400, 'Informe o nome da profissional.');
    const item = await transaction(async (client) => {
      const { rows } = await client.query('INSERT INTO professionals (name,email) VALUES ($1,$2) RETURNING id,name,email,active',
        [name, string(input.email) || null]);
      await audit(client, user, 'create', 'professional', rows[0].id);
      return rows[0];
    });
    return reply(response, 201, { item });
  }

  if (method === 'GET' && path === '/api/users') {
    requireRole(user, 'admin');
    const { rows } = await pool.query('SELECT id,name,email,role,professional_id,active FROM users ORDER BY name');
    return reply(response, 200, { items: rows });
  }
  if (method === 'POST' && path === '/api/users') {
    requireRole(user, 'admin');
    const input = await bodyOf(request);
    const name = string(input.name);
    const email = emailOf(input.email);
    const role = input.role;
    const professionalId = role === 'professional' ? requireUuid(input.professionalId, 'Profissional') : null;
    if (!name || !['admin', 'professional'].includes(role)) throw problem(400, 'Dados de conta inválidos.');
    if (typeof input.password !== 'string' || input.password.length < 12) {
      throw problem(400, 'A senha inicial precisa ter pelo menos 12 caracteres.');
    }
    const passwordHash = await hashPassword(input.password);
    const item = await transaction(async (client) => {
      const { rows } = await client.query(`INSERT INTO users (name,email,password_hash,role,professional_id)
        VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,role,professional_id,active`,
      [name, email, passwordHash, role, professionalId]);
      await audit(client, user, 'create', 'user', rows[0].id);
      return rows[0];
    });
    return reply(response, 201, { item });
  }

  if (method === 'GET' && path === '/api/patients') {
    const { rows } = await pool.query(`
      SELECT p.id,p.name,p.phone,p.email,p.birth_date,p.status,
        array_agg(pp.professional_id) AS professional_ids
      FROM patients p JOIN patient_professionals pp ON pp.patient_id = p.id
      WHERE $1::text = 'admin' OR pp.professional_id = $2::uuid
      GROUP BY p.id ORDER BY p.name
    `, [user.role, user.professional_id]);
    return reply(response, 200, { items: rows });
  }
  if (method === 'POST' && path === '/api/patients') {
    requireRole(user, 'admin');
    const input = await bodyOf(request);
    const name = string(input.name);
    const professionals = [...new Set(Array.isArray(input.professionalIds) ? input.professionalIds : [])];
    if (!name || !professionals.length || professionals.some((id) => !uuid(id))) throw problem(400, 'Informe nome e profissionais responsáveis.');
    const item = await transaction(async (client) => {
      const { rows } = await client.query(`INSERT INTO patients (name,phone,email,birth_date) VALUES ($1,$2,$3,$4)
        RETURNING id,name,phone,email,birth_date,status`,
      [name, string(input.phone) || null, string(input.email) || null, input.birthDate || null]);
      for (const professionalId of professionals) {
        await client.query('INSERT INTO patient_professionals (patient_id,professional_id) VALUES ($1,$2)', [rows[0].id, professionalId]);
      }
      await audit(client, user, 'create', 'patient', rows[0].id);
      return rows[0];
    });
    return reply(response, 201, { item });
  }

  if (method === 'GET' && path === '/api/appointments') {
    const from = dateOf(url.searchParams.get('from'), 'Data inicial');
    const to = dateOf(url.searchParams.get('to'), 'Data final');
    const { rows } = await pool.query(`
      SELECT a.id,a.patient_id,a.professional_id,a.starts_at,a.ends_at,a.status,a.modality,
        p.name AS patient_name, pr.name AS professional_name
      FROM appointments a JOIN patients p ON p.id = a.patient_id
      JOIN professionals pr ON pr.id = a.professional_id
      WHERE a.starts_at >= $1 AND a.starts_at < $2
        AND ($3::text = 'admin' OR a.professional_id = $4::uuid)
      ORDER BY a.starts_at,pr.name
    `, [from, to, user.role, user.professional_id]);
    return reply(response, 200, { items: rows });
  }
  if (method === 'POST' && path === '/api/appointments') {
    requireRole(user, 'admin');
    const input = await bodyOf(request);
    const patientId = requireUuid(input.patientId, 'Paciente');
    const professionalId = requireUuid(input.professionalId, 'Profissional');
    const start = dateOf(input.startsAt, 'Data inicial');
    const end = dateOf(input.endsAt, 'Data final');
    if (end <= start) throw problem(400, 'O horário final precisa ser posterior ao inicial.');
    const item = await transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [professionalId]);
      const assigned = await client.query('SELECT 1 FROM patient_professionals WHERE patient_id=$1 AND professional_id=$2', [patientId, professionalId]);
      if (!assigned.rowCount) throw problem(400, 'Paciente não vinculado à profissional.');
      const conflict = await client.query(`SELECT 1 FROM appointments WHERE professional_id=$1 AND status <> 'cancelled'
        AND starts_at < $3 AND ends_at > $2 LIMIT 1`, [professionalId, start, end]);
      if (conflict.rowCount) throw problem(409, 'Já existe sessão nesse horário para esta profissional.');
      const { rows } = await client.query(`INSERT INTO appointments
        (patient_id,professional_id,starts_at,ends_at,modality,created_by)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [patientId, professionalId, start, end, input.modality === 'online' ? 'online' : 'presencial', user.id]);
      await audit(client, user, 'create', 'appointment', rows[0].id);
      return rows[0];
    });
    return reply(response, 201, { item });
  }

  if (method === 'GET' && path === '/api/clinical-notes') {
    requireRole(user, 'professional');
    const patientId = requireUuid(url.searchParams.get('patientId'), 'Paciente');
    const { rows } = await pool.query(`SELECT n.id,n.patient_id,n.appointment_id,n.body,n.created_at
      FROM clinical_notes n JOIN patient_professionals pp ON pp.patient_id=n.patient_id AND pp.professional_id=n.professional_id
      WHERE n.patient_id=$1 AND n.professional_id=$2 ORDER BY n.created_at DESC`, [patientId, user.professional_id]);
    return reply(response, 200, { items: rows });
  }
  if (method === 'POST' && path === '/api/clinical-notes') {
    requireRole(user, 'professional');
    const input = await bodyOf(request);
    const patientId = requireUuid(input.patientId, 'Paciente');
    const note = string(input.body, 20000);
    if (!note) throw problem(400, 'Escreva a evolução.');
    const item = await transaction(async (client) => {
      const assigned = await client.query('SELECT 1 FROM patient_professionals WHERE patient_id=$1 AND professional_id=$2',
        [patientId, user.professional_id]);
      if (!assigned.rowCount) throw problem(403, 'Paciente fora da sua carteira.');
      const appointmentId = input.appointmentId ? requireUuid(input.appointmentId, 'Sessão') : null;
      if (appointmentId) {
        const match = await client.query('SELECT 1 FROM appointments WHERE id=$1 AND patient_id=$2 AND professional_id=$3',
          [appointmentId, patientId, user.professional_id]);
        if (!match.rowCount) throw problem(400, 'Sessão não pertence a este atendimento.');
      }
      const { rows } = await client.query(`INSERT INTO clinical_notes (patient_id,professional_id,appointment_id,body)
        VALUES ($1,$2,$3,$4) RETURNING id,patient_id,appointment_id,body,created_at`,
      [patientId, user.professional_id, appointmentId, note]);
      await audit(client, user, 'create', 'clinical_note', rows[0].id);
      return rows[0];
    });
    return reply(response, 201, { item });
  }

  if (method === 'GET' && path === '/api/google-calendars') {
    const { rows } = await pool.query(`SELECT gc.id,gc.professional_id,gc.display_name,gc.access_role,gc.selected,gc.last_synced_at,
      ga.google_email,pr.name AS professional_name
      FROM google_calendars gc JOIN google_accounts ga ON ga.id=gc.google_account_id
      JOIN professionals pr ON pr.id=gc.professional_id
      WHERE $1::text='admin' OR gc.professional_id=$2::uuid ORDER BY pr.name,gc.display_name`,
    [user.role, user.professional_id]);
    return reply(response, 200, { items: rows });
  }

  throw problem(404, 'Recurso não encontrado.');
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    if (error.code === '23505') return reply(response, 409, { error: 'Este cadastro já existe.' });
    if (error.code === '23503' || error.code === '23514' || error.code === '22P02') return reply(response, 400, { error: 'Dados inválidos para este cadastro.' });
    if (error.status) return reply(response, error.status, { error: error.message });
    console.error(error);
    reply(response, 500, { error: 'Não foi possível concluir a operação.' });
  });
});

server.listen(port, '127.0.0.1', () => console.log(`Sistema local: http://127.0.0.1:${port}`));
