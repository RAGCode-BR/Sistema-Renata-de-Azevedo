// Sincronização com o Google: envia as sessões da fila (cria, atualiza ou remove eventos, com Meet nas
// on-line) e lê os horários ocupados dos calendários marcados. Chamada pelo pg_cron (cabeçalho
// x-sync-secret) ou por alguém da equipe conectado ("Sincronizar agora").
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { GoogleError, accessToken, api, decryptToken, eventBody, eventTitle, googleConfig } from '../_shared/google.ts';
import type { GoogleConfig } from '../_shared/google.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const FREE = ['cancelled_by_patient', 'cancelled_by_clinic', 'rescheduled'];
const BUSY_DAYS = 60;

interface Calendar { id: string; google_calendar_id: string; google_account_id: string; professional_id: string; selected: boolean }
interface GoogleEvent { id: string; etag?: string; hangoutLink?: string; status?: string; transparency?: string;
  start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; extendedProperties?: { private?: Record<string, string> } }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'Método não permitido.' });
  const config = googleConfig();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const secret = Deno.env.get('GOOGLE_SYNC_SECRET');
  const bySecret = Boolean(secret) && request.headers.get('x-sync-secret') === secret;
  if (!bySecret) {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    const { data: staff } = user ? await admin.from('user_roles').select('role').eq('user_id', user.id).neq('role', 'patient').limit(1) : { data: null };
    if (!user || !staff?.length) return reply(401, { error: 'Entre na sua conta para continuar.' });
  }
  if (!config.configured) return reply(503, { error: 'A integração com o Google ainda não foi configurada pela administração.', code: 'not_configured' });

  const tokens = new Map<string, Promise<string>>();
  const tokenFor = (accountId: string) => {
    if (!tokens.has(accountId)) {
      tokens.set(accountId, (async () => {
        const { data } = await admin.from('google_accounts').select('refresh_token_ciphertext, refresh_token_iv, refresh_token_tag').eq('id', accountId).single();
        return accessToken(config, await decryptToken(config, data!));
      })());
    }
    return tokens.get(accountId)!;
  };
  const calendars = new Map<string, Calendar>();
  const calendarOf = async (id: string) => {
    if (!calendars.has(id)) {
      const { data } = await admin.from('google_calendars').select('id, google_calendar_id, google_account_id, professional_id, selected').eq('id', id).single();
      calendars.set(id, data as Calendar);
    }
    return calendars.get(id)!;
  };

  const { data: settings } = await admin.from('clinic_settings').select('google_event_title').single();
  const titleMode = settings?.google_event_title ?? 'initials';
  let pushed = 0, removed = 0, failed = 0;
  const errors: string[] = [];

  const { data: queue } = await admin.from('calendar_sync_queue').select('id, action, appointment_id, google_calendar_id, google_event_id, attempts')
    .is('done_at', null).lt('attempts', 5).order('id').limit(100);
  for (const item of queue ?? []) {
    try {
      const calendar = await calendarOf(item.google_calendar_id);
      const token = await tokenFor(calendar.google_account_id);
      const path = `/calendar/v3/calendars/${encodeURIComponent(calendar.google_calendar_id)}/events`;
      if (item.action === 'delete') {
        await removeEvent(config, token, path, item.google_event_id);
        await admin.from('calendar_event_links').delete().eq('google_calendar_id', calendar.id).eq('google_event_id', item.google_event_id);
        removed++;
      } else {
        const result = await upsertEvent(admin, config, token, path, calendar, item.appointment_id, titleMode);
        if (result === 'removed') removed++; else pushed++;
      }
      await admin.from('calendar_sync_queue').update({ done_at: new Date().toISOString(), last_error: null }).eq('id', item.id);
    } catch (failure) {
      failed++;
      const message = failure instanceof Error ? failure.message : String(failure);
      errors.push(message);
      await admin.from('calendar_sync_queue').update({ attempts: item.attempts + 1, last_error: message.slice(0, 500) }).eq('id', item.id);
    }
  }

  // Horários ocupados dos calendários marcados (sem títulos; os eventos do próprio sistema ficam de fora).
  let busy = 0;
  const { data: selected } = await admin.from('google_calendars').select('id, google_calendar_id, google_account_id, professional_id, selected').eq('selected', true);
  for (const calendar of (selected ?? []) as Calendar[]) {
    try {
      const token = await tokenFor(calendar.google_account_id);
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + BUSY_DAYS * 86_400_000).toISOString();
      const list = await api<{ items?: GoogleEvent[] }>(config, token,
        `/calendar/v3/calendars/${encodeURIComponent(calendar.google_calendar_id)}/events?singleEvents=true&orderBy=startTime&maxResults=2500` +
        `&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}`);
      const rows = (list.items ?? [])
        .filter((event) => event.status !== 'cancelled' && event.transparency !== 'transparent' && !event.extendedProperties?.private?.rdaAppointment)
        .map((event) => ({
          professional_id: calendar.professional_id, google_calendar_id: calendar.id,
          starts_at: event.start?.dateTime ?? `${event.start?.date}T00:00:00-03:00`,
          ends_at: event.end?.dateTime ?? `${event.end?.date}T00:00:00-03:00`
        }))
        .filter((row) => new Date(row.ends_at) > new Date(row.starts_at));
      await admin.from('google_busy').delete().eq('google_calendar_id', calendar.id);
      if (rows.length) await admin.from('google_busy').insert(rows);
      await admin.from('google_calendars').update({ last_synced_at: new Date().toISOString() }).eq('id', calendar.id);
      busy += rows.length;
    } catch (failure) {
      failed++;
      errors.push(failure instanceof GoogleError && failure.status === 400 ? 'Uma conta Google precisa ser reconectada.' : String(failure));
    }
  }

  await admin.from('integration_state').update({
    last_run_at: new Date().toISOString(), last_error: errors[0]?.slice(0, 500) ?? null, updated_at: new Date().toISOString()
  }).eq('key', 'google');
  return reply(200, { pushed, removed, busy, failed });
});

async function removeEvent(config: GoogleConfig, token: string, path: string, eventId: string | null) {
  if (!eventId) return;
  try {
    await api(config, token, `${path}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  } catch (failure) {
    if (!(failure instanceof GoogleError && [404, 410].includes(failure.status))) throw failure;
  }
}

async function upsertEvent(admin: SupabaseClient, config: GoogleConfig, token: string, path: string, calendar: Calendar,
  appointmentId: string, titleMode: string): Promise<'pushed' | 'removed'> {
  const { data: appointment } = await admin.from('appointments')
    .select('id, starts_at, ends_at, status, modality, meeting_url, professional_id, patients(name)').eq('id', appointmentId).maybeSingle();
  const { data: link } = await admin.from('calendar_event_links').select('google_event_id')
    .eq('appointment_id', appointmentId).eq('google_calendar_id', calendar.id).maybeSingle();

  if (!appointment || FREE.includes(appointment.status) || appointment.professional_id !== calendar.professional_id) {
    if (link) {
      await removeEvent(config, token, path, link.google_event_id);
      await admin.from('calendar_event_links').delete().eq('appointment_id', appointmentId).eq('google_calendar_id', calendar.id);
    }
    return 'removed';
  }

  const patient = (appointment.patients as unknown as { name: string } | null)?.name ?? '';
  const body = eventBody({
    appointmentId, title: eventTitle(titleMode, patient), startsAt: appointment.starts_at, endsAt: appointment.ends_at,
    online: appointment.modality === 'online', meetingUrl: appointment.meeting_url, appUrl: config.appUrl
  });
  let event: GoogleEvent | null = null;
  if (link) {
    try {
      event = await api<GoogleEvent>(config, token, `${path}/${encodeURIComponent(link.google_event_id)}?conferenceDataVersion=1`,
        { method: 'PATCH', body: JSON.stringify(body) });
    } catch (failure) {
      if (!(failure instanceof GoogleError && [404, 410].includes(failure.status))) throw failure;
    }
  }
  event ??= await api<GoogleEvent>(config, token, `${path}?conferenceDataVersion=1`, { method: 'POST', body: JSON.stringify(body) });
  await admin.from('calendar_event_links').upsert({
    appointment_id: appointmentId, google_calendar_id: calendar.id, google_event_id: event.id, google_etag: event.etag ?? null,
    last_synced_at: new Date().toISOString()
  }, { onConflict: 'appointment_id,google_calendar_id' });
  if (event.hangoutLink && event.hangoutLink !== appointment.meeting_url && appointment.modality === 'online') {
    await admin.from('appointments').update({ meeting_url: event.hangoutLink }).eq('id', appointmentId);
  }
  return 'pushed';
}
