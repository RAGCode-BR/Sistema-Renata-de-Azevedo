// Google Agenda/Meet: configuração, cifra do token, estado assinado do OAuth e chamadas à API.
// Segredos (supabase secrets): GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (do Google Cloud),
// GOOGLE_TOKEN_KEY (32 bytes em base64, cifra os tokens), GOOGLE_SYNC_SECRET (chamada do pg_cron)
// e APP_URL (endereço do sistema, para voltar depois da autorização).
// GOOGLE_AUTH_URL, GOOGLE_OAUTH_URL e GOOGLE_API_URL só mudam em testes (servidor simulado).

export const SCOPES = [
  'openid', 'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
];

const env = (name: string, fallback = '') => Deno.env.get(name) ?? fallback;

export function googleConfig() {
  const clientId = env('GOOGLE_CLIENT_ID');
  const clientSecret = env('GOOGLE_CLIENT_SECRET');
  const tokenKey = env('GOOGLE_TOKEN_KEY');
  return {
    configured: Boolean(clientId && clientSecret && tokenKey),
    clientId, clientSecret, tokenKey,
    redirectUri: `${env('SUPABASE_URL')}/functions/v1/google-oauth-callback`,
    appUrl: env('APP_URL', 'http://localhost:5173').replace(/\/$/, ''),
    authUrl: env('GOOGLE_AUTH_URL', 'https://accounts.google.com/o/oauth2/v2/auth'),
    oauthUrl: env('GOOGLE_OAUTH_URL', 'https://oauth2.googleapis.com'),
    apiUrl: env('GOOGLE_API_URL', 'https://www.googleapis.com'),
    userinfoUrl: env('GOOGLE_USERINFO_URL', 'https://openidconnect.googleapis.com/v1/userinfo')
  };
}
export type GoogleConfig = ReturnType<typeof googleConfig>;

// Base64 / bytea -------------------------------------------------------------------------------

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
export const toBytea = (bytes: Uint8Array) => '\\x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
export const fromBytea = (text: string) => Uint8Array.from((text.replace(/^\\x/, '').match(/../g) ?? []).map((h) => parseInt(h, 16)));

// Cifra do refresh token (AES-256-GCM) ----------------------------------------------------------

async function aesKey(config: GoogleConfig) {
  const raw = Uint8Array.from(atob(config.tokenKey), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error('GOOGLE_TOKEN_KEY precisa ter 32 bytes em base64.');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptToken(config: GoogleConfig, token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(config), new TextEncoder().encode(token)));
  return { ciphertext: sealed.slice(0, -16), iv, tag: sealed.slice(-16) };
}

export async function decryptToken(config: GoogleConfig, row: { refresh_token_ciphertext: string; refresh_token_iv: string; refresh_token_tag: string }) {
  const ciphertext = fromBytea(row.refresh_token_ciphertext);
  const tag = fromBytea(row.refresh_token_tag);
  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext);
  sealed.set(tag, ciphertext.length);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBytea(row.refresh_token_iv) }, await aesKey(config), sealed);
  return new TextDecoder().decode(plain);
}

// Estado do OAuth: quem pediu e até quando vale, assinado (HMAC) com a chave dos tokens.

async function hmac(config: GoogleConfig, data: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`state:${config.tokenKey}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))));
}

export async function signState(config: GoogleConfig, userId: string) {
  const payload = toBase64Url(new TextEncoder().encode(JSON.stringify({ u: userId, e: Date.now() + 10 * 60_000, n: crypto.randomUUID() })));
  return `${payload}.${await hmac(config, payload)}`;
}

export async function verifyState(config: GoogleConfig, state: string): Promise<string | null> {
  const [payload, signature] = state.split('.');
  if (!payload || !signature || signature !== await hmac(config, payload)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return typeof data.u === 'string' && data.e > Date.now() ? data.u : null;
  } catch {
    return null;
  }
}

// API do Google -------------------------------------------------------------------------------

export class GoogleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!response.ok) throw new GoogleError(response.status, `${response.status} ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const form = (data: Record<string, string>) => ({
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString()
});

export function exchangeCode(config: GoogleConfig, code: string) {
  return call<{ access_token: string; refresh_token?: string }>(`${config.oauthUrl}/token`, form({
    code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: 'authorization_code'
  }));
}

export async function accessToken(config: GoogleConfig, refreshToken: string) {
  return (await call<{ access_token: string }>(`${config.oauthUrl}/token`, form({
    refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token'
  }))).access_token;
}

export function revoke(config: GoogleConfig, token: string) {
  return call<unknown>(`${config.oauthUrl}/revoke`, form({ token })).catch(() => undefined);
}

export function api<T>(config: GoogleConfig, token: string, path: string, init: RequestInit = {}) {
  return call<T>(`${config.apiUrl}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  });
}

export function userinfo(config: GoogleConfig, token: string) {
  return call<{ sub: string; email: string }>(config.userinfoUrl, { headers: { Authorization: `Bearer ${token}` } });
}

export interface CalendarListEntry { id: string; summary: string; accessRole: string; primary?: boolean }

// Evento da sessão. Título conforme a configuração da clínica; nada clínico na descrição.
export function eventTitle(mode: string, patientName: string) {
  if (mode === 'generic') return 'Atendimento';
  if (mode === 'full') return `Atendimento: ${patientName}`;
  const initials = patientName.split(/\s+/).filter((part) => part.length > 2 || /^[A-ZÀ-Ú]/.test(part))
    .map((part) => part[0]?.toUpperCase()).filter(Boolean).slice(0, 3).join('. ');
  return `Atendimento (${initials ? `${initials}.` : 'paciente'})`;
}

export function eventBody(input: {
  appointmentId: string; title: string; startsAt: string; endsAt: string; online: boolean; meetingUrl: string | null; appUrl: string;
}) {
  return {
    summary: input.title,
    description: `Sessão gerenciada pelo sistema da clínica; alterações feitas aqui não mudam a agenda do sistema.\n${input.appUrl}/#/agenda`,
    start: { dateTime: input.startsAt },
    end: { dateTime: input.endsAt },
    location: input.online ? input.meetingUrl ?? undefined : undefined,
    extendedProperties: { private: { rdaAppointment: input.appointmentId } },
    reminders: { useDefault: true },
    ...(input.online && !input.meetingUrl
      ? { conferenceData: { createRequest: { requestId: input.appointmentId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } }
      : {})
  };
}
