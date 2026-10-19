// Teste de integração do assistente de IA: função real (Deno, local) + banco real + API da Anthropic simulada.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import http from 'node:http';

const PROJECT = process.env.PROJECT_DIR;
const { createClient } = createRequire(`${PROJECT}/package.json`)('@supabase/supabase-js');
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let n = 0;
const ok = (m) => console.log(`✔ ${++n}. ${m}`);
const fail = (m) => { throw new Error(m); };
const must = async (q, label) => { const r = await q; if (r.error) throw new Error(label + ': ' + r.error.message); return r; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TRANSCRIPT = `Profissional: Bom dia, Helena! Como você chegou hoje?
Helena Martins: Cheguei cansada. Essa semana discuti de novo com o Rodrigo por causa da divisão das tarefas de casa.
Profissional: Vamos olhar para o momento da discussão. O que você sentiu naquela hora?
Helena Martins: Senti que ninguém me escuta. Depois fiquei dois dias sem falar com ele.
Profissional: Hoje vamos praticar o registro de pensamentos. Até a próxima sessão, anote duas situações em que você sentir isso.
Helena Martins: Combinado. Ah, você pode me mandar o recibo de setembro? Meu telefone é (21) 97777-4321 e o CPF 529.982.247-25.`;

const requests = [];
const anthropic = http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c;
  const data = JSON.parse(body);
  requests.push({ headers: req.headers, data });
  const sent = JSON.stringify(data.messages);
  const quote = (t) => t;
  const draft = {
    summary: { text: 'Paciente relata nova discussão com o parceiro sobre a divisão das tarefas domésticas.', evidence: [quote('Essa semana discuti de novo com o [NOME] por causa da divisão das tarefas de casa.')] },
    topics: [
      { text: 'Sentimento de não ser escutada.', evidence: ['Senti que ninguém me escuta.'] },
      { text: 'Hipótese diagnóstica de transtorno depressivo (F32).', evidence: ['Cheguei cansada.'] }
    ],
    evolution: {
      themes: [{ text: 'Conflito conjugal sobre tarefas domésticas.', evidence: ['discuti de novo com o [NOME]'] }],
      interventions: [{ text: 'Treino de registro de pensamentos.', evidence: ['Hoje vamos praticar o registro de pensamentos.'] }],
      observations: [{ text: 'Paciente ficou dois dias sem falar com o parceiro.', evidence: ['Depois fiquei dois dias sem falar com ele.'] },
        { text: 'Paciente tem histórico de traumas na infância.', evidence: ['Minha infância foi difícil'] }],
      agreements: [{ text: 'Anotar duas situações até a próxima sessão.', evidence: ['anote duas situações em que você sentir isso'] }]
    },
    admin_tasks: [{ text: 'Enviar recibo de setembro', evidence: ['você pode me mandar o recibo de setembro?'] }],
    gaps: ['Duração da sessão não aparece na transcrição.']
  };
  res.writeHead(200, { 'Content-Type': 'application/json', 'request-id': 'req_teste' });
  res.end(JSON.stringify({
    id: 'msg_teste', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
    content: [{ type: 'text', text: JSON.stringify(draft) }],
    usage: { input_tokens: 2400, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    _received: sent.length
  }));
});
await new Promise((r) => anthropic.listen(9933, r));

const child = spawn(process.env.DENO_BIN, ['run', '--node-modules-dir=none', '--allow-net', '--allow-env', '--allow-read', `${PROJECT}/supabase/functions/ai-draft/index.ts`], {
  cwd: process.env.WORK_DIR, stdio: process.env.VERBOSE ? 'inherit' : 'ignore',
  env: { ...process.env, SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY: ANON,
    ANTHROPIC_API_KEY: 'chave-teste', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9933', DENO_SERVE_ADDRESS: 'tcp:127.0.0.1:8821', NO_COLOR: '1' }
});
for (let i = 0; i < 90; i++) { try { await fetch('http://127.0.0.1:8821', { method: 'OPTIONS' }); break; } catch { await sleep(500); } }

const ids = { professional: crypto.randomUUID(), patient: crypto.randomUUID(), appointment: crypto.randomUUID(), user: null };
const EMAIL = 'teste-ia@example.test';
const PASSWORD = 'Senha-IA-teste-1';

async function cleanup() {
  await admin.from('clinical_notes').delete().eq('patient_id', ids.patient).eq('status', 'draft');
  await admin.from('appointments').delete().eq('patient_id', ids.patient);
  await admin.from('patient_professionals').delete().eq('patient_id', ids.patient);
  await admin.from('patients').delete().eq('name', 'Helena Martins');
  const { data: users } = await admin.auth.admin.listUsers();
  for (const user of users.users.filter((u) => u.email === EMAIL)) await admin.auth.admin.deleteUser(user.id);
  await admin.from('professionals').delete().eq('name', 'Teste IA Prof');
  await admin.from('ai_settings').update({ enabled: false, monthly_limit_usd: null }).eq('id', true);
  await admin.from('audit_log').delete().in('entity_type', ['ai_consent', 'ai']);
}

try {
  await cleanup();
  await must(admin.from('professionals').insert({ id: ids.professional, name: 'Teste IA Prof' }), 'profissional');
  const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true,
    user_metadata: { name: 'Teste IA Prof' }, app_metadata: { roles: ['professional'], professional_id: ids.professional } });
  ids.user = created.user.id;
  await must(admin.from('patients').insert({ id: ids.patient, name: 'Helena Martins', cpf: '52998224725', phone: '(21) 97777-4321', email: 'helena@exemplo.test' }), 'paciente');
  await must(admin.from('patient_professionals').insert({ patient_id: ids.patient, professional_id: ids.professional }), 'vínculo');
  const start = new Date(Date.now() - 3 * 3600_000);
  await must(admin.from('appointments').insert({ id: ids.appointment, patient_id: ids.patient, professional_id: ids.professional,
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 50 * 60000).toISOString(), status: 'completed', modality: 'presencial' }), 'sessão');
  await must(admin.from('ai_settings').update({ enabled: true, monthly_limit_usd: 5 }).eq('id', true), 'ligar IA');

  const user = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data: signed } = await user.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const jwt = signed.session.access_token;
  const call = (body) => fetch('http://127.0.0.1:8821', { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // 1. Sem termo e sem consentimento, nada sai do sistema.
  const blocked = await user.rpc('create_ai_transcript', { p_patient_id: ids.patient, p_appointment_id: ids.appointment, p_source: 'paste', p_file_name: null, p_content: TRANSCRIPT, p_extra_terms: ['Rodrigo'] });
  if (!blocked.error) fail('Transcrição aceita sem termo e consentimento');
  await must(user.rpc('accept_ai_terms'), 'termo');
  await must(user.rpc('set_ai_consent', { p_patient_id: ids.patient, p_granted: true, p_notes: 'Termo assinado (teste)' }), 'consentimento');
  const { data: transcriptId } = await must(user.rpc('create_ai_transcript', { p_patient_id: ids.patient, p_appointment_id: ids.appointment,
    p_source: 'paste', p_file_name: null, p_content: TRANSCRIPT, p_extra_terms: ['Rodrigo'] }), 'transcrição');
  ok('Sem termo e consentimento a transcrição é recusada; com os dois, é aceita');

  // 2. Rascunho: o que chega à Anthropic e o que volta.
  const res = await call({ transcriptId });
  const out = await res.json();
  if (res.status !== 200 || !out.runId) fail('ai-draft: ' + res.status + ' ' + JSON.stringify(out));
  const sent = requests[0];
  const payload = JSON.stringify(sent.data.messages) + JSON.stringify(sent.data.system);
  const leaked = ['Helena', 'Martins', 'Rodrigo', '97777', '529.982', 'helena@'].filter((t) => payload.includes(t));
  if (leaked.length) fail('Dados pessoais enviados: ' + leaked.join(', '));
  if (sent.data.model !== 'claude-opus-5-5' || sent.data.output_config?.format?.type !== 'json_schema' || sent.data.output_config?.effort !== 'high'
    || sent.data.fallbacks !== 'default' || !String(sent.headers['anthropic-beta']).includes('server-side-fallback-2026-07-01') || sent.headers['x-api-key'] !== 'chave-teste') {
    fail('Pedido à API: ' + JSON.stringify({ model: sent.data.model, oc: sent.data.output_config, fb: sent.data.fallbacks, beta: sent.headers['anthropic-beta'] }));
  }
  ok('Enviado à IA sem nome, sobrenome, nome do parceiro, telefone, CPF ou e-mail; modelo claude-opus-5-5, formato JSON fixo, esforço alto e fallback padrão');

  const { data: run } = await must(user.rpc('ai_get_run', { p_run_id: out.runId }), 'abrir rascunho');
  const topics = run.result.topics.map((t) => t.text);
  const obs = run.result.evolution.observations.map((t) => t.text);
  if (topics.some((t) => t.includes('F32')) || obs.some((t) => t.includes('infância')) || run.warnings.length !== 2
    || !run.result.summary || run.result.admin_tasks.length !== 1 || !run.redacted_text.includes('[NOME]')) {
    fail('Conferência: ' + JSON.stringify({ topics, obs, warnings: run.warnings }));
  }
  const expected = Math.round((2400 * 4 + 900 * 20) / 1e6 * 10000) / 10000;
  if (Number(run.cost_usd) !== expected) fail(`Custo: ${run.cost_usd} (esperado ${expected})`);
  ok(`Conferência: item com diagnóstico (F32) e item sem trecho na transcrição removidos (2 avisos); custo US$ ${expected} registrado`);

  if (process.env.PAUSE_FOR_UI) { console.log('PAUSA_UI'); await new Promise((r) => process.stdin.once('data', r)); }

  // 3. Depois da revisão na tela: rascunho de evolução, não finalizado.
  const { data: notes } = await admin.from('clinical_notes').select('status, ai_run_id, body').eq('patient_id', ids.patient);
  if (process.env.PAUSE_FOR_UI) {
    if (notes.length !== 1 || notes[0].status !== 'draft' || notes[0].ai_run_id !== out.runId) fail('Evolução: ' + JSON.stringify(notes));
    ok('Rascunho usado na tela virou RASCUNHO de evolução com a origem marcada (nada finalizado sozinho)');
  }

  // 4. Revogação bloqueia e apaga.
  await must(user.rpc('set_ai_consent', { p_patient_id: ids.patient, p_granted: false }), 'revogar');
  const again = await call({ transcriptId });
  const { data: after } = await admin.from('ai_transcripts').select('content').eq('id', transcriptId).single();
  if (again.status !== 403 || after.content !== null) fail('Revogação: ' + again.status + ' ' + JSON.stringify(after));
  ok('Consentimento revogado: o assistente recusa e a transcrição guardada é apagada');
} catch (error) {
  console.log('✘ Falhou:', error.message);
  process.exitCode = 1;
} finally {
  await cleanup().catch((e) => console.log('limpeza:', e.message));
  child.kill();
  anthropic.close();
  const { count } = await admin.from('ai_runs').select('id', { count: 'exact', head: true });
  console.log('execuções de IA restantes:', count);
}
