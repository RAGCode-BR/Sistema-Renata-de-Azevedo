// Dados fictícios para a homologação com a equipe.
// Uso (na raiz do projeto): node tests/homologacao/rodar.mjs criar | limpar
// "limpar" apaga também os arquivos enviados para esses pacientes (o banco não apaga arquivos sozinho).
// Antes do uso real: rode "limpar" e confira que o resultado mostra zero restantes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const action = process.argv[2];
if (!['criar', 'limpar'].includes(action)) { console.log('Uso: node tests/homologacao/rodar.mjs criar | limpar'); process.exit(1); }

const query = (args) => execFileSync('npx', ['supabase', 'db', 'query', '--linked', ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const rows = (out) => JSON.parse(out.slice(out.indexOf('{'))).rows ?? [];

if (action === 'limpar') {
  // Arquivos dos pacientes fictícios (documentos administrativos, clínicos e do portal).
  const files = rows(query([`SELECT o.bucket_id, o.name FROM storage.objects o
    WHERE o.bucket_id IN ('patient-documents', 'clinical-documents', 'portal-documents')
      AND split_part(o.name, '/', 2) IN (SELECT id::text FROM public.patients WHERE admin_notes LIKE '[HOMOLOGAÇÃO]%')`]));
  if (files.length) {
    const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
    const url = env.VITE_SUPABASE_URL;
    const ref = new URL(url).hostname.split('.')[0];
    const key = JSON.parse(execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', ref, '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
      .find((k) => k.name === 'service_role').api_key;
    const { createClient } = createRequire(path.join(ROOT, 'package.json'))('@supabase/supabase-js');
    const admin = createClient(url, key, { auth: { persistSession: false } });
    for (const bucket of new Set(files.map((f) => f.bucket_id))) {
      const { error } = await admin.storage.from(bucket).remove(files.filter((f) => f.bucket_id === bucket).map((f) => f.name));
      if (error) { console.log('Erro ao apagar arquivos: ' + error.message); process.exit(1); }
    }
  }
  console.log(`Arquivos apagados: ${files.length}`);
}
const result = rows(query(['-f', path.join('tests', 'homologacao', `${action}.sql`)]));
console.log(result[0] ?? 'feito');
