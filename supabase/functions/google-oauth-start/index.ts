// Início da conexão com o Google: devolve o endereço de autorização para a profissional conectada.
import { reply, serveUser } from '../_shared/admin.ts';
import { SCOPES, googleConfig, signState } from '../_shared/google.ts';

serveUser(async ({ admin, asCaller, caller }) => {
  const config = googleConfig();
  if (!config.configured) return reply(503, { error: 'A integração com o Google ainda não foi configurada pela administração.', code: 'not_configured' });
  const { data: access } = await asCaller.rpc('my_access');
  const { data: profile } = await admin.from('profiles').select('professional_id').eq('id', caller.id).maybeSingle();
  if (!profile?.professional_id || !access?.roles?.includes('professional')) {
    return reply(403, { error: 'Só profissionais conectam a agenda do Google.' });
  }
  const url = new URL(config.authUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: await signState(config, caller.id),
    ...(caller.email ? { login_hint: caller.email } : {})
  }).toString();
  return reply(200, { url: url.toString() });
});
