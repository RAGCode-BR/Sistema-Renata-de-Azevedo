// Google simulado: OAuth, userinfo, lista de calendários e eventos (com Meet). Guarda as chamadas em `log`.
import http from 'node:http';
export const log = [];
export const events = new Map(); // id -> { calendar, body }
let seq = 0;
const day = (offset, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d.toISOString(); };
export function start(port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    let body = '';
    for await (const chunk of req) body += chunk;
    log.push({ method: req.method, path: url.pathname, search: url.search, auth: req.headers.authorization, body });
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(data === undefined ? '' : JSON.stringify(data)); };
    if (url.pathname === '/token') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'authorization_code') {
        return form.get('code') === 'codigo-bom' ? json(200, { access_token: 'acesso-1', refresh_token: 'mock-refresh-token-secreto' }) : json(400, { error: 'invalid_grant' });
      }
      return form.get('refresh_token') === 'mock-refresh-token-secreto' ? json(200, { access_token: 'acesso-2' }) : json(400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/revoke') return json(200, {});
    if (url.pathname === '/userinfo') return json(200, { sub: 'google-sub-e2e', email: 'prof-google-e2e@gmail.test' });
    if (!['Bearer acesso-1', 'Bearer acesso-2'].includes(req.headers.authorization)) return json(401, { error: 'unauthorized' });
    if (url.pathname === '/calendar/v3/users/me/calendarList') {
      return json(200, { items: [
        { id: 'prof-google-e2e@gmail.test', summary: 'Agenda pessoal', accessRole: 'owner', primary: true },
        { id: 'feriados#holiday@group.v.calendar.google.com', summary: 'Feriados', accessRole: 'reader' }
      ] });
    }
    const match = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (match) {
      const calendar = decodeURIComponent(match[1]);
      const id = match[2] && decodeURIComponent(match[2]);
      if (req.method === 'POST') {
        const data = JSON.parse(body);
        const event = { ...data, id: `evento-${++seq}`, etag: `"${seq}"`, ...(data.conferenceData?.createRequest ? { hangoutLink: 'https://meet.google.com/abc-defg-hij' } : {}) };
        events.set(event.id, { calendar, body: event });
        return json(200, event);
      }
      if (req.method === 'PATCH') {
        if (!events.has(id)) return json(404, { error: 'not found' });
        const event = { ...events.get(id).body, ...JSON.parse(body) };
        events.set(id, { calendar, body: event });
        return json(200, event);
      }
      if (req.method === 'DELETE') {
        if (!events.has(id)) return json(410, { error: 'gone' });
        events.delete(id);
        res.writeHead(204); return res.end();
      }
      if (req.method === 'GET') {
        const ours = [...events.values()].filter((e) => e.calendar === calendar).map((e) => e.body);
        const personal = [
          { id: 'pessoal-1', status: 'confirmed', start: { dateTime: day(1, 15) }, end: { dateTime: day(1, 16) } },
          { id: 'livre-1', status: 'confirmed', transparency: 'transparent', start: { dateTime: day(1, 17) }, end: { dateTime: day(1, 18) } },
          { id: 'cancelado-1', status: 'cancelled', start: { dateTime: day(2, 9) }, end: { dateTime: day(2, 10) } }
        ];
        return json(200, { items: calendar.startsWith('feriados') ? [{ id: 'feriado', status: 'confirmed', start: { date: day(3, 0).slice(0, 10) }, end: { date: day(4, 0).slice(0, 10) } }] : [...ours, ...personal] });
      }
    }
    json(404, { error: 'rota simulada não encontrada', path: url.pathname });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
