// Códigos para colar no site (WordPress: bloco "HTML personalizado"). Sem bibliotecas: só HTML e JS.
// 1) Rastreador (cabeçalho de todas as páginas): guarda por 30 dias as UTMs do link do anúncio.
// 2) Formulário: envia para a Edge Function lead-capture, com consentimento e campo-isca contra robôs.

export function trackerSnippet(): string {
  return `<script>
(function () {
  var params = new URLSearchParams(location.search), keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'], found = {};
  keys.forEach(function (k) { if (params.get(k)) found[k] = params.get(k); });
  try { if (Object.keys(found).length) localStorage.setItem('rda_utm', JSON.stringify({ at: Date.now(), data: found })); } catch (e) {}
})();
</script>`;
}

export function formSnippet(endpoint: string, whatsapp: string): string {
  return `<form id="rda-contato" style="display:grid;gap:12px;max-width:520px;font:inherit">
  <label>Nome <input name="name" required maxlength="200" style="width:100%;padding:10px"></label>
  <label>WhatsApp (com DDD) <input name="phone" type="tel" maxlength="40" style="width:100%;padding:10px"></label>
  <label>E-mail <input name="email" type="email" maxlength="200" style="width:100%;padding:10px"></label>
  <label>Como podemos ajudar?
    <select name="interest" style="width:100%;padding:10px">
      <option>Terapia de casal</option><option>Terapia individual</option><option>Coaching de relacionamento</option>
      <option>Terapia de casal homoafetivo</option><option>Outro</option>
    </select></label>
  <label>Atendimento
    <select name="location" style="width:100%;padding:10px">
      <option>On-line</option><option>Barra da Tijuca</option><option>Botafogo</option><option>Quinta da Boa Vista</option><option>São Paulo</option>
    </select></label>
  <label>Mensagem (opcional) <textarea name="message" maxlength="2000" rows="3" style="width:100%;padding:10px"></textarea></label>
  <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
  <label style="display:flex;gap:8px;align-items:flex-start"><input type="checkbox" name="consent" required>
    <span>Autorizo o contato da equipe Renata de Azevedo pelos dados acima, conforme a LGPD.</span></label>
  <button type="submit" style="padding:12px 18px;cursor:pointer">Quero ser contatado(a)</button>
  <p id="rda-contato-msg" role="status" style="margin:0"></p>
</form>
<script>
(function () {
  var form = document.getElementById('rda-contato'), msg = document.getElementById('rda-contato-msg'), started = Date.now();
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var f = new FormData(form), utm = {};
    try { var saved = JSON.parse(localStorage.getItem('rda_utm') || 'null'); if (saved && Date.now() - saved.at < 2592000000) utm = saved.data; } catch (e) {}
    new URLSearchParams(location.search).forEach(function (v, k) { if (k.indexOf('utm_') === 0) utm[k] = v; });
    if (!f.get('phone') && !f.get('email')) { msg.textContent = 'Informe seu WhatsApp ou e-mail.'; return; }
    var body = { name: f.get('name'), phone: f.get('phone'), email: f.get('email'), interest: f.get('interest'), location: f.get('location'),
      message: f.get('message'), website: f.get('website'), consent: f.get('consent') === 'on', elapsed_ms: Date.now() - started,
      page: location.href.slice(0, 500), utm_source: utm.utm_source, utm_medium: utm.utm_medium, utm_campaign: utm.utm_campaign, utm_content: utm.utm_content };
    form.querySelector('button').disabled = true; msg.textContent = 'Enviando…';
    fetch('${endpoint}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok) { form.reset(); msg.textContent = 'Recebemos seu contato! Em breve nossa equipe fala com você.'; }
        else { msg.textContent = (res.d && res.d.error) || 'Não foi possível enviar.'; form.querySelector('button').disabled = false; }
      })
      .catch(function () { msg.innerHTML = 'Não foi possível enviar. <a href="https://wa.me/${whatsapp}">Fale pelo WhatsApp</a>.'; form.querySelector('button').disabled = false; });
  });
})();
</script>`;
}

// Planilha (CSV) ---------------------------------------------------------------------------------

// Lê CSV com vírgula ou ponto e vírgula, aspas e quebras de linha dentro de aspas.
export function parseCsv(content: string): string[][] {
  const textValue = content.replace(/^﻿/, '');
  const firstLine = textValue.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < textValue.length; i++) {
    const char = textValue[i];
    if (quoted) {
      if (char === '"' && textValue[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && textValue[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export const IMPORT_FIELDS = [
  ['name', 'Nome', /^(nome|name|contato|cliente|lead)/],
  ['phone', 'Telefone', /(telefone|celular|whats|phone|fone)/],
  ['email', 'E-mail', /(e-?mail)/],
  ['source', 'Origem', /(origem|fonte|source|canal)/],
  ['campaign', 'Campanha', /(campanha|campaign|an[uú]ncio)/],
  ['stage', 'Etapa / situação', /(etapa|status|situa|fase|stage|funil)/],
  ['created_at', 'Data de entrada', /(data|criad|created|entrada)/],
  ['notes', 'Observações', /(obs|nota|notes|coment|descri)/]
] as const;

// Datas "dd/mm/aaaa [hh:mm]" viram ISO; outras ficam como estão (o banco ignora as inválidas).
export function normalizeDate(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return value.trim();
  const [, day, month, year, hour = '12', minute = '00'] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:00-03:00`;
}
