// Desconecta uma conta Google: remove do Google os eventos que o sistema criou, revoga a autorização e
// apaga a conta (calendários, vínculos e horários ocupados saem junto). Só a dona da conta ou quem
// gerencia usuários.
import { reply, serveUser, UUID } from '../_shared/admin.ts';
import { accessToken, api, decryptToken, googleConfig, revoke } from '../_shared/google.ts';

serveUser(async ({ admin, asCaller, caller, input }) => {
  const id = typeof input.accountId === 'string' ? input.accountId : '';
  if (!UUID.test(id)) return reply(400, { error: 'Conta inválida.' });
  const { data: account } = await admin.from('google_accounts')
    .select('id, user_id, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag').eq('id', id).maybeSingle();
  if (!account) return reply(404, { error: 'Conta Google não encontrada.' });
  if (account.user_id !== caller.id) {
    const { data: access } = await asCaller.rpc('my_access');
    if (!access?.permissions?.includes('users.manage')) return reply(403, { error: 'Só a dona da conta pode desconectá-la.' });
  }

  const config = googleConfig();
  let removed = 0;
  if (config.configured) {
    try {
      const refresh = await decryptToken(config, account);
      const token = await accessToken(config, refresh);
      const { data: links } = await admin.from('calendar_event_links')
        .select('google_event_id, google_calendars!inner(google_calendar_id, google_account_id)').eq('google_calendars.google_account_id', id);
      for (const link of links ?? []) {
        const calendar = link.google_calendars as unknown as { google_calendar_id: string };
        await api(config, token, `/calendar/v3/calendars/${encodeURIComponent(calendar.google_calendar_id)}/events/${encodeURIComponent(link.google_event_id)}`,
          { method: 'DELETE' }).then(() => removed++, () => undefined);
      }
      await revoke(config, refresh);
    } catch (failure) {
      console.error(failure); // Conta já revogada no Google: segue apagando aqui.
    }
  }
  const { error } = await admin.from('google_accounts').delete().eq('id', id);
  if (error) return reply(500, { error: 'Não foi possível desconectar.' });
  await admin.from('audit_log').insert({ actor_user_id: caller.id, action: 'disconnect', entity_type: 'google_account', entity_id: id });
  return reply(200, { ok: true, removedEvents: removed });
});
