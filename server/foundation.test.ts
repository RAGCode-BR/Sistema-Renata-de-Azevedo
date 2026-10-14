import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { hashPassword } from './auth.ts';
import { applyMigrations } from './migrate.ts';

const dbName = `renata_test_${randomBytes(5).toString('hex')}`;
const port = 10000 + Math.floor(Math.random() * 40000);
const base = `http://127.0.0.1:${port}`;
const adminPassword = 'Test-Password-123!';

function waitForServer(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Servidor não iniciou: ${output}`)), 10000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk;
      if (output.includes('Sistema local:')) { clearTimeout(timer); resolve(); }
    });
    child.stderr?.on('data', (chunk: Buffer) => { output += chunk; });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`Servidor encerrou (${code}): ${output}`)); });
  });
}

interface RequestOptions { method?: string; body?: unknown; cookie?: string }

async function request(path: string, { method = 'GET', body, cookie }: RequestOptions = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { 'X-Requested-With':'clinic-local', ...(body ? { 'Content-Type':'application/json' } : {}), ...(cookie ? { Cookie:cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status:response.status, data:await response.json() as any, cookie:response.headers.get('set-cookie')?.split(';')[0] };
}

test('contas, cadastros e isolamento de prontuários', async () => {
  const adminDb = new pg.Pool({ database:'postgres', host:'/tmp' });
  let testDb: pg.Pool | undefined;
  let server: ChildProcess | undefined;
  try {
    await adminDb.query(`CREATE DATABASE ${dbName}`);
    testDb = new pg.Pool({ database:dbName, host:'/tmp' });
    await applyMigrations(testDb);
    await testDb.query('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)',
      ['Admin Teste','admin@example.test',await hashPassword(adminPassword),'admin']);
    // Sem DATABASE_URL, para nunca testar contra o banco externo.
    const { DATABASE_URL: _external, ...env } = process.env;
    server = spawn(process.execPath, ['server/index.ts'], {
      cwd:new URL('../', import.meta.url), env:{ ...env, PGDATABASE:dbName, PGHOST:'/tmp', PORT:String(port) },
      stdio:['ignore','pipe','pipe']
    });
    await waitForServer(server);

    const login = await request('/api/session', { method:'POST', body:{ email:'admin@example.test', password:adminPassword } });
    assert.equal(login.status, 200);
    const adminCookie = login.cookie;
    assert.ok(adminCookie?.startsWith('rda_session='));

    const professional = await request('/api/professionals', { method:'POST', cookie:adminCookie,
      body:{ name:'Profissional Teste', email:'prof@example.test' } });
    assert.equal(professional.status, 201);
    const professionalId = professional.data.item.id;
    const account = await request('/api/users', { method:'POST', cookie:adminCookie,
      body:{ name:'Profissional Teste', email:'prof@example.test', role:'professional', professionalId, password:adminPassword } });
    assert.equal(account.status, 201);
    const patient = await request('/api/patients', { method:'POST', cookie:adminCookie,
      body:{ name:'Paciente Teste', professionalIds:[professionalId] } });
    assert.equal(patient.status, 201);
    const patientId = patient.data.item.id;
    const appointment = await request('/api/appointments', { method:'POST', cookie:adminCookie,
      body:{ patientId, professionalId, startsAt:'2026-11-03T12:00:00.000Z', endsAt:'2026-11-03T12:50:00.000Z' } });
    assert.equal(appointment.status, 201);
    const conflict = await request('/api/appointments', { method:'POST', cookie:adminCookie,
      body:{ patientId, professionalId, startsAt:'2026-11-03T12:25:00.000Z', endsAt:'2026-11-03T13:00:00.000Z' } });
    assert.equal(conflict.status, 409);

    const proLogin = await request('/api/session', { method:'POST', body:{ email:'prof@example.test', password:adminPassword } });
    assert.equal(proLogin.status, 200);
    const proCookie = proLogin.cookie;
    assert.equal((await request('/api/users', { cookie:proCookie })).status, 403);
    assert.equal((await request('/api/clinical-notes?patientId=' + patientId, { cookie:adminCookie })).status, 403);
    assert.equal((await request('/api/patients', { cookie:proCookie })).data.items.length, 1);
    assert.equal((await request('/api/appointments?from=2026-11-03T00:00:00Z&to=2026-11-04T00:00:00Z', { cookie:proCookie })).data.items.length, 1);

    const note = await request('/api/clinical-notes', { method:'POST', cookie:proCookie,
      body:{ patientId, appointmentId:appointment.data.item.id, body:'Anotação de teste.' } });
    assert.equal(note.status, 201);
    assert.equal((await request('/api/clinical-notes?patientId=' + patientId, { cookie:proCookie })).data.items.length, 1);
    const adminPatients = await request('/api/patients', { cookie:adminCookie });
    assert.equal(adminPatients.data.items.length, 1);
    assert.equal('body' in adminPatients.data.items[0], false);

    const tooShort = await request('/api/me/password', { method:'PATCH', cookie:proCookie,
      body:{ currentPassword:adminPassword, newPassword:'Nova-1234' } });
    assert.equal(tooShort.status, 400);
    const changed = await request('/api/me/password', { method:'PATCH', cookie:proCookie,
      body:{ currentPassword:adminPassword, newPassword:'Nova-12345' } });
    assert.equal(changed.status, 200);
    assert.equal((await request('/api/session', { method:'POST', body:{ email:'prof@example.test', password:adminPassword } })).status, 401);
    assert.equal((await request('/api/session', { method:'POST', body:{ email:'prof@example.test', password:'Nova-12345' } })).status, 200);
  } finally {
    if (server) {
      server.kill();
      await new Promise((resolve) => server!.once('exit', resolve));
    }
    await testDb?.end();
    await adminDb.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await adminDb.end();
  }
});
