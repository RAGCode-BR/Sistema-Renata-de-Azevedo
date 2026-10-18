// Volta do Google: confere o estado assinado, troca o código pelos tokens, guarda o refresh token cifrado,
// importa a lista de calendários e volta para a página Google Agenda do sistema.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  api, exchangeCode, encryptToken, googleConfig, toBytea, userinfo, verifyState
} from '../_shared/google.ts';
import type { CalendarListEntry } from '../_shared/google.ts';

const ROLES = new Set(['owner', 'writer', 'reader', 'freeBusyReader']);

Deno.serve(async (request) => {
  const config = googleConfig();
  const back = (result: string) => Response.redirect(`${config.appUrl}/#/google-agenda?google=${result}`, 302);
  if (!config.configured) return back('nao-configurado');

  const params = new URL(request.url).searchParams;
  if (params.get('error')) return back('cancelado');
  const userId = await verifyState(config, params.get('state') ?? '');
  const code = params.get('code');
  if (!userId || !code) return back('invalido');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const { data: profile } = await admin.from('profiles').select('id, professional_id, active').eq('id', userId).single();
    if (!profile?.active || !profile.professional_id) return back('sem-permissao');

    const tokens = await exchangeCode(config, code);
    if (!tokens.refresh_token) return back('sem-token');
    const me = await userinfo(config, tokens.access_token);
    const sealed = await encryptToken(config, tokens.refresh_token);
    const { data: account, error } = await admin.from('google_accounts').upsert({
      user_id: userId, google_subject: me.sub, google_email: me.email, refresh_token_ciphertext: toBytea(sealed.ciphertext),
      refresh_token_iv: toBytea(sealed.iv), refresh_token_tag: toBytea(sealed.tag), connected_at: new Date().toISOString()
    }, { onConflict: 'user_id,google_subject' }).select('id').single();
    if (error || !account) throw error ?? new Error('conta não gravada');

    const list = await api<{ items?: CalendarListEntry[] }>(config, tokens.access_token, '/calendar/v3/users/me/calendarList?minAccessRole=freeBusyReader');
    const { data: target } = await admin.from('google_calendars').select('id').eq('professional_id', profile.professional_id).eq('push_target', true).maybeSingle();
    let needsTarget = !target;
    for (const item of list.items ?? []) {
      if (!ROLES.has(item.accessRole)) continue;
      const pushTarget = needsTarget && Boolean(item.primary) && ['owner', 'writer'].includes(item.accessRole);
      if (pushTarget) needsTarget = false;
      const { data: existing } = await admin.from('google_calendars').select('id').eq('google_account_id', account.id).eq('google_calendar_id', item.id).maybeSingle();
      if (existing) {
        await admin.from('google_calendars').update({ display_name: item.summary, access_role: item.accessRole }).eq('id', existing.id);
      } else {
        await admin.from('google_calendars').insert({
          google_account_id: account.id, professional_id: profile.professional_id, google_calendar_id: item.id,
          display_name: item.summary, access_role: item.accessRole, selected: Boolean(item.primary), push_target: false
        });
        if (pushTarget) {
          // Pelo mesmo caminho da interface: escolhe o destino e enfileira as sessões futuras.
          const { data: created } = await admin.from('google_calendars').select('id').eq('google_account_id', account.id).eq('google_calendar_id', item.id).single();
          await admin.rpc('set_google_calendar_as_owner', { p_user_id: userId, p_id: created!.id });
        }
      }
    }
    await admin.from('integration_state').update({ enabled: true, updated_at: new Date().toISOString() }).eq('key', 'google');
    await admin.from('audit_log').insert({ actor_user_id: userId, action: 'connect', entity_type: 'google_account', entity_id: account.id });
    return back('conectado');
  } catch (failure) {
    console.error(failure);
    return back('erro');
  }
});
