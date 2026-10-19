// Edge Functions publicadas: nenhuma atende sem login, sem segredo ou de outro site.
// Não cria dados: só chamadas que devem ser recusadas. Rodado por tests/run.mjs.
const BASE = `${process.env.SUPABASE_URL}/functions/v1`;
let n = 0;
let failed = false;
const post = (name, headers = {}, body = '{}') =>
  fetch(`${BASE}/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body, redirect: 'manual' });

// Exigem login (token de uma conta).
const withLogin = ['admin-create-user', 'admin-delete-user', 'clinical-document-url', 'google-oauth-start', 'google-disconnect',
  'google-sync', 'whatsapp-send', 'ai-draft', 'portal-invite', 'portal-document-url'];
// Chamadas só pelo agendador do banco (segredo interno).
const withSecret = ['push-send', 'portal-email-send', 'google-sync', 'whatsapp-send'];

for (const name of withLogin) {
  const res = await post(name);
  if (res.status !== 401) { failed = true; console.log(`✘ ${name} sem login respondeu ${res.status}`); }
}
console.log(`✔ ${++n}. ${withLogin.length} funções recusam chamada sem login (401)`);

for (const name of withSecret) {
  const res = await post(name, { 'x-sync-secret': 'segredo-errado' });
  if (res.status !== 401) { failed = true; console.log(`✘ ${name} com segredo errado respondeu ${res.status}`); }
}
console.log(`✔ ${++n}. ${withSecret.length} funções do agendador recusam segredo errado (401)`);

// Também recusam um token que não é de uma conta (a chave pública sozinha).
const anon = await post('portal-invite', { Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}` });
if (anon.status !== 401) { failed = true; console.log(`✘ portal-invite com a chave pública respondeu ${anon.status}`); }
console.log(`✔ ${++n}. Chave pública sozinha não vale como login`);

const lead = await post('lead-capture', { Origin: 'https://site-estranho.example' }, JSON.stringify({ name: 'Teste', phone: '11999999999' }));
if (lead.status !== 403) { failed = true; console.log(`✘ lead-capture de outro site respondeu ${lead.status}`); }
console.log(`✔ ${++n}. Formulário de leads recusa envio de outro site (403)`);

const verify = await fetch(`${BASE}/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1`);
const unsigned = await post('whatsapp-webhook', {}, JSON.stringify({ entry: [] }));
if (verify.status !== 403 || ![401, 403, 503].includes(unsigned.status)) {
  failed = true; console.log(`✘ webhook do WhatsApp: verificação ${verify.status}, sem assinatura ${unsigned.status}`);
}
console.log(`✔ ${++n}. Webhook do WhatsApp recusa verificação errada e mensagem sem assinatura`);

const callback = await fetch(`${BASE}/google-oauth-callback?code=x&state=adulterado`, { redirect: 'manual' });
const location = callback.headers.get('location') ?? '';
if (callback.status !== 302 || !/google=(invalido|nao-configurado)/.test(location)) {
  failed = true; console.log(`✘ retorno do Google com estado adulterado: ${callback.status} ${location}`);
}
console.log(`✔ ${++n}. Retorno do Google com estado adulterado não conecta nada`);

if (failed) { console.log('✘ Falhou'); process.exit(1); }
console.log('Sem erros');
