const $ = (selector) => document.querySelector(selector);
const state = { user: null, page: 'agenda', patients: [], professionals: [] };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const dateTime = (value) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—';
const dateOnly = (value) => value ? new Date(value).toLocaleDateString('pt-BR', { timeZone:'UTC' }) : '—';

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type':'application/json', 'X-Requested-With':'clinic-local' },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Falha na comunicação com o servidor.');
  return data;
}

function message(text, error = false) {
  const node = $('#message');
  node.textContent = text;
  node.classList.toggle('error', error);
}

function showLogin() {
  $('#login-view').hidden = false;
  $('#app-view').hidden = true;
}

function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#account-name').textContent = state.user.name;
  $('#account-role').textContent = state.user.role === 'admin' ? 'Administração' : 'Profissional';
  const items = [
    ['agenda','Agenda'], ['pacientes','Pacientes'],
    ...(state.user.role === 'admin' ? [['profissionais','Profissionais'], ['contas','Contas']] : [['prontuarios','Prontuários']]),
    ['calendarios','Google Agenda']
  ];
  $('#nav').innerHTML = items.map(([id, label]) => `<button type="button" data-page="${id}" class="${state.page === id ? 'active' : ''}">${label}</button>`).join('');
  $('#nav').querySelectorAll('[data-page]').forEach((button) => button.onclick = () => {
    state.page = button.dataset.page;
    showApp();
    render().catch((error) => message(error.message, true));
  });
}

async function commonData() {
  const [professionals, patients] = await Promise.all([api('/api/professionals'), api('/api/patients')]);
  state.professionals = professionals.items;
  state.patients = patients.items;
}

function professionalOptions() {
  return state.professionals.filter((item) => item.active).map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
}

function patientOptions() {
  return state.patients.filter((item) => item.status === 'active').map((item) => `<option value="${item.id}">${esc(item.name)}</option>`).join('');
}

function formValues(form) {
  return Object.fromEntries(new FormData(form));
}

function attachForm(selector, action) {
  $(selector).onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await action(event.currentTarget);
      message('Cadastro salvo.');
      await render();
    } catch (error) {
      message(error.message, true);
      button.disabled = false;
    }
  };
}

async function renderAgenda() {
  await commonData();
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endDate = new Date(startDate.getTime() + 7 * 86400000);
  const from = startDate.toISOString();
  const to = endDate.toISOString();
  const { items } = await api(`/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const admin = state.user.role === 'admin';
  $('#content').innerHTML = `
    <section class="heading"><div><h1>Agenda</h1><p>Próximos sete dias · ${items.length} ${items.length === 1 ? 'sessão' : 'sessões'}</p></div></section>
    ${admin && (!state.patients.length || !state.professionals.length) ? '<p class="notice">Cadastre uma profissional e um paciente antes de agendar a primeira sessão.</p>' : ''}
    ${admin ? `<section class="panel"><div class="panel-head"><h2>Nova sessão</h2></div><form id="appointment-form" class="panel-body form-grid">
      <label>Paciente<select name="patientId" required>${patientOptions()}</select></label>
      <label>Profissional<select name="professionalId" required>${professionalOptions()}</select></label>
      <label>Início<input name="startsAt" type="datetime-local" required></label>
      <label>Fim<input name="endsAt" type="datetime-local" required></label>
      <label>Modalidade<select name="modality"><option value="presencial">Presencial</option><option value="online">On-line</option></select></label>
      <button type="submit" ${!state.patients.length || !state.professionals.length ? 'disabled' : ''}>Agendar</button>
    </form></section>` : ''}
    <section class="panel"><div class="panel-head"><h2>Sessões</h2></div>
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Início</th><th>Paciente</th><th>Profissional</th><th>Situação</th></tr></thead><tbody>
        ${items.map((item) => `<tr><td>${dateTime(item.starts_at)}</td><td>${esc(item.patient_name)}</td><td>${esc(item.professional_name)}</td><td>${esc(item.status)}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">Nenhuma sessão neste período.</p>'}
    </section>`;
  if (admin) attachForm('#appointment-form', async (form) => {
    const values = formValues(form);
    await api('/api/appointments', { method:'POST', body:JSON.stringify({
      ...values, startsAt:new Date(values.startsAt).toISOString(), endsAt:new Date(values.endsAt).toISOString()
    }) });
  });
}

async function renderPatients() {
  await commonData();
  const admin = state.user.role === 'admin';
  $('#content').innerHTML = `
    <section class="heading"><div><h1>Pacientes</h1><p>${state.patients.length} ${state.patients.length === 1 ? 'cadastro' : 'cadastros'}</p></div></section>
    ${admin ? `<section class="panel"><div class="panel-head"><h2>Novo paciente</h2></div><form id="patient-form" class="panel-body form-grid">
      <label>Nome<input name="name" required></label><label>Telefone<input name="phone" autocomplete="off"></label>
      <label>E-mail<input name="email" type="email" autocomplete="off"></label><label>Nascimento<input name="birthDate" type="date"></label>
      <div class="full"><p class="muted">Profissionais responsáveis</p><div class="check-list">
        ${state.professionals.filter((item) => item.active).map((item) => `<label><input type="checkbox" name="professionalIds" value="${item.id}">${esc(item.name)}</label>`).join('')}
      </div></div><button type="submit">Cadastrar paciente</button>
    </form></section>` : ''}
    <section class="panel"><div class="panel-head"><h2>Lista de pacientes</h2></div>
      ${state.patients.length ? `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>Telefone</th><th>Nascimento</th><th>Situação</th></tr></thead><tbody>
        ${state.patients.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.phone || '—')}</td><td>${dateOnly(item.birth_date)}</td><td>${item.status === 'active' ? 'Ativo' : 'Encerrado'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">Nenhum paciente cadastrado.</p>'}
    </section>`;
  if (admin) attachForm('#patient-form', async (form) => {
    const values = formValues(form);
    await api('/api/patients', { method:'POST', body:JSON.stringify({ ...values,
      professionalIds:[...form.querySelectorAll('input[name="professionalIds"]:checked')].map((input) => input.value)
    }) });
  });
}

async function renderProfessionals() {
  const { items } = await api('/api/professionals');
  state.professionals = items;
  $('#content').innerHTML = `
    <section class="heading"><div><h1>Profissionais</h1><p>${items.length} ${items.length === 1 ? 'profissional' : 'profissionais'}</p></div></section>
    <section class="panel"><div class="panel-head"><h2>Nova profissional</h2></div><form id="professional-form" class="panel-body form-grid">
      <label>Nome<input name="name" required></label><label>E-mail<input name="email" type="email"></label>
      <button type="submit">Cadastrar profissional</button>
    </form></section>
    <section class="panel"><div class="panel-head"><h2>Equipe</h2></div>
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Situação</th></tr></thead><tbody>
        ${items.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.email || '—')}</td><td>${item.active ? 'Ativa' : 'Inativa'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">Nenhuma profissional cadastrada.</p>'}
    </section>`;
  attachForm('#professional-form', async (form) => api('/api/professionals', { method:'POST', body:JSON.stringify(formValues(form)) }));
}

async function renderUsers() {
  const [users, professionals] = await Promise.all([api('/api/users'), api('/api/professionals')]);
  state.professionals = professionals.items;
  $('#content').innerHTML = `
    <section class="heading"><div><h1>Contas</h1><p>Acesso individual para administração e profissionais.</p></div></section>
    <section class="panel"><div class="panel-head"><h2>Nova conta</h2></div><form id="user-form" class="panel-body form-grid">
      <label>Nome<input name="name" required></label><label>E-mail<input name="email" type="email" required></label>
      <label>Função<select name="role"><option value="professional">Profissional</option><option value="admin">Administração</option></select></label>
      <label id="professional-field">Profissional<select name="professionalId"><option value="">Selecione</option>${professionalOptions()}</select></label>
      <label class="full">Senha inicial (mínimo de 12 caracteres)<input name="password" type="password" minlength="12" autocomplete="new-password" required></label>
      <button type="submit">Criar conta</button>
    </form></section>
    <section class="panel"><div class="panel-head"><h2>Usuários</h2></div><div class="table-wrap"><table>
      <thead><tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Situação</th></tr></thead><tbody>
      ${users.items.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(item.email)}</td><td>${item.role === 'admin' ? 'Administração' : 'Profissional'}</td><td>${item.active ? 'Ativa' : 'Inativa'}</td></tr>`).join('')}
      </tbody></table></div></section>`;
  const role = $('#user-form select[name="role"]');
  role.onchange = () => { $('#professional-field').hidden = role.value === 'admin'; };
  attachForm('#user-form', async (form) => api('/api/users', { method:'POST', body:JSON.stringify(formValues(form)) }));
}

async function renderCalendars() {
  const { items } = await api('/api/google-calendars');
  $('#content').innerHTML = `
    <section class="heading"><div><h1>Google Agenda</h1><p>Cada profissional poderá autorizar a própria conta e selecionar mais de um calendário.</p></div></section>
    <p class="notice">A estrutura para várias contas e calendários já está no banco local. A conexão OAuth e a sincronização aguardam a configuração do aplicativo no Google Cloud; nenhum calendário está conectado ainda.</p>
    <section class="panel" style="margin-top:22px"><div class="panel-head"><h2>Calendários vinculados</h2></div>
    ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Profissional</th><th>Conta Google</th><th>Calendário</th><th>Sincronizado</th></tr></thead><tbody>
      ${items.map((item) => `<tr><td>${esc(item.professional_name)}</td><td>${esc(item.google_email)}</td><td>${esc(item.display_name)}</td><td>${dateTime(item.last_synced_at)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="empty">Nenhum calendário conectado.</p>'}</section>`;
}

async function renderNotes() {
  await commonData();
  $('#content').innerHTML = `
    <section class="heading"><div><h1>Prontuários</h1><p>Somente suas anotações clínicas.</p></div></section>
    <section class="panel"><div class="panel-head"><h2>Paciente</h2></div><div class="panel-body">
      <label>Selecionar paciente<select id="note-patient"><option value="">Escolha</option>${patientOptions()}</select></label>
    </div></section><div id="notes-content"></div>`;
  $('#note-patient').onchange = () => loadNotes($('#note-patient').value);
}

async function loadNotes(patientId) {
  const target = $('#notes-content');
  if (!patientId) { target.innerHTML = ''; return; }
  const { items } = await api(`/api/clinical-notes?patientId=${encodeURIComponent(patientId)}`);
  target.innerHTML = `<section class="panel"><div class="panel-head"><h2>Nova evolução</h2></div><form id="note-form" class="panel-body form-grid">
    <label class="full">Anotação<textarea name="body" rows="6" required></textarea></label><button type="submit">Salvar evolução</button>
  </form></section><section class="panel"><div class="panel-head"><h2>Histórico</h2></div>
    ${items.length ? items.map((item) => `<div class="panel-body" style="border-bottom:1px solid var(--line)"><p class="muted">${dateTime(item.created_at)}</p><p style="white-space:pre-wrap">${esc(item.body)}</p></div>`).join('') : '<p class="empty">Sem evoluções registradas.</p>'}
  </section>`;
  $('#note-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/clinical-notes', { method:'POST', body:JSON.stringify({ patientId, body:form.elements.namedItem('body').value }) });
      message('Evolução salva.');
      await loadNotes(patientId);
    } catch (error) {
      message(error.message, true);
      button.disabled = false;
    }
  };
}

async function render() {
  if (!state.user) return;
  const pages = { agenda:renderAgenda, pacientes:renderPatients, profissionais:renderProfessionals,
    contas:renderUsers, calendarios:renderCalendars, prontuarios:renderNotes };
  if (state.user.role === 'admin' && state.page === 'prontuarios') state.page = 'agenda';
  await pages[state.page]();
}

$('#login-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = $('#login-error');
  error.hidden = true;
  try {
    const values = formValues(form);
    state.user = await api('/api/session', { method:'POST', body:JSON.stringify(values) });
    form.reset();
    showApp();
    await render();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  }
};

$('#logout').onclick = async () => {
  await api('/api/session', { method:'DELETE' });
  state.user = null;
  showLogin();
};

$('#change-password').onclick = () => $('#password-dialog').showModal();
$('#cancel-password').onclick = () => $('#password-dialog').close();
$('#password-form').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  $('#password-error').hidden = true;
  try {
    await api('/api/me/password', { method:'PATCH', body:JSON.stringify(formValues(form)) });
    form.reset();
    $('#password-dialog').close();
    message('Senha alterada.');
  } catch (error) {
    $('#password-error').textContent = error.message;
    $('#password-error').hidden = false;
  }
};

try {
  const { user } = await api('/api/session');
  state.user = user;
  if (user) { showApp(); await render(); }
  else showLogin();
} catch (error) {
  showLogin();
  $('#login-error').textContent = 'Servidor indisponível.';
  $('#login-error').hidden = false;
}
