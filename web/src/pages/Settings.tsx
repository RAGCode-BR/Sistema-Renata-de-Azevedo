import type { ClinicSettings } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { text, useFormSubmit, useLoad } from '../hooks.ts';
import { dateTime } from '../format.ts';

const whole = (value: string, min: number, max: number, label: string) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label}: informe um número entre ${min} e ${max}.`);
  return number;
};

// Configurações da clínica (permissão settings.manage): prazo do prontuário e política de cobrança.
export function SettingsPage() {
  const notify = useToast();
  const { data, error, reload } = useLoad(api.settings, []);
  const record = useFormSubmit(async (form) => {
    await api.updateSettings({ note_deadline_hours: whole(text(form, 'hours'), 1, 720, 'Prazo') });
    notify('Configurações salvas.');
    reload();
  });
  const google = useFormSubmit(async (form) => {
    await api.updateSettings({ google_event_title: text(form, 'title') as ClinicSettings['google_event_title'] });
    notify('Configuração do Google salva.');
    reload();
  });
  const billing = useFormSubmit(async (form) => {
    await api.updateSettings({
      missed_charge_percent: whole(text(form, 'missed'), 0, 100, 'Falta'),
      late_cancel_hours: whole(text(form, 'lateHours'), 0, 168, 'Antecedência'),
      late_cancel_charge_percent: whole(text(form, 'latePercent'), 0, 100, 'Cancelamento tardio')
    });
    notify('Política de cobrança salva.');
    reload();
  });

  if (!data) return <><Heading title="Configurações" /><PanelState error={error} loading={!error} empty="" /></>;

  return (
    <>
      <Heading title="Configurações" lead="Regras gerais da clínica." />
      <Panel title="Prontuário">
        <form className="panel-body form-grid" onSubmit={record.onSubmit} key={`p${data.note_deadline_hours}`}>
          <Field label="Prazo para finalizar a evolução (horas após o fim da sessão)">
            <input className="input" name="hours" type="number" min={1} max={720} required defaultValue={data.note_deadline_hours} />
          </Field>
          <p className="muted small full">Depois do prazo, a sessão aparece como atrasada no controle de prontuários e no painel; evoluções finalizadas depois dele ficam como &ldquo;finalizado fora do prazo&rdquo;.</p>
          {record.error && <p className="erro full" role="alert">{record.error}</p>}
          <div className="full"><button type="submit" className="button" disabled={record.busy}>{record.busy ? 'Salvando…' : 'Salvar'}</button></div>
        </form>
      </Panel>
      <Panel title="Google Agenda">
        <form className="panel-body form-grid" onSubmit={google.onSubmit} key={`g${data.google_event_title}`}>
          <Field label="Título dos eventos das sessões no Google">
            <select className="input" name="title" defaultValue={data.google_event_title}>
              <option value="initials">Só as iniciais do paciente (recomendado)</option>
              <option value="generic">Apenas "Atendimento"</option>
              <option value="full">Nome completo do paciente</option>
            </select>
          </Field>
          <p className="muted small full">O Google é um serviço externo: quanto menos dado do paciente, melhor (LGPD). A mudança vale para os próximos envios.</p>
          {google.error && <p className="erro full" role="alert">{google.error}</p>}
          <div className="full"><button type="submit" className="button" disabled={google.busy}>{google.busy ? 'Salvando…' : 'Salvar'}</button></div>
        </form>
      </Panel>
      <WhatsappPanel settings={data} onSaved={reload} />
      <AiPanel />
      <PushPanel />
      <PortalPanel />
      <SecurityPanel required={data.require_mfa} onSaved={reload} />
      <Panel title="Política de cobrança">
        <form className="panel-body form-grid" onSubmit={billing.onSubmit}
          key={`c${data.missed_charge_percent}-${data.late_cancel_hours}-${data.late_cancel_charge_percent}`}>
          <Field label="Falta: % do valor da sessão cobrado">
            <input className="input" name="missed" type="number" min={0} max={100} required defaultValue={data.missed_charge_percent} />
          </Field>
          <span />
          <Field label="Cancelamento pelo paciente com menos de (horas)">
            <input className="input" name="lateHours" type="number" min={0} max={168} required defaultValue={data.late_cancel_hours} />
          </Field>
          <Field label="… cobra este % do valor">
            <input className="input" name="latePercent" type="number" min={0} max={100} required defaultValue={data.late_cancel_charge_percent} />
          </Field>
          <p className="muted small full">A cobrança é criada sozinha quando a sessão é marcada como realizada (100%), falta ou cancelamento tardio (percentuais acima). Cancelamento pela clínica não gera cobrança. Mudanças valem para as próximas marcações.</p>
          {billing.error && <p className="erro full" role="alert">{billing.error}</p>}
          <div className="full"><button type="submit" className="button" disabled={billing.busy}>{billing.busy ? 'Salvando…' : 'Salvar política'}</button></div>
        </form>
      </Panel>
    </>
  );
}

const TEMPLATES = [
  ['confirmacao_sessao', 'Olá, {{1}}! Sua sessão com {{2}} está marcada para {{3}}. Podemos confirmar?', 'Botões de resposta rápida: "Confirmar" e "Preciso remarcar"'],
  ['lembrete_sessao', 'Olá, {{1}}! Lembrete: sua sessão com {{2}} é {{3}}. Atendimento: {{4}}.', 'Sem botões'],
  ['aviso_tarefa', 'Você tem uma nova tarefa no sistema da clínica Renata de Azevedo. Acesse: {{1}}', 'Sem botões']
];

// WhatsApp: ativação dos envios, endereço do sistema (links) e horários. Os modelos precisam estar
// aprovados na Meta com estes nomes e textos (idioma pt_BR, categoria Utilidade).
function WhatsappPanel({ settings, onSaved }: { settings: ClinicSettings; onSaved: () => void }) {
  const notify = useToast();
  const { data: state, reload } = useLoad(api.whatsappState, []);
  const form = useFormSubmit(async (data) => {
    await api.updateSettings({
      whatsapp_confirm_hours: whole(text(data, 'confirm'), 0, 168, 'Confirmação'),
      whatsapp_reminder_hours: whole(text(data, 'reminder'), 0, 48, 'Lembrete')
    });
    await api.setWhatsappSettings(data.get('enabled') === 'on', text(data, 'appUrl'));
    notify('Configuração do WhatsApp salva.');
    onSaved();
    reload();
  });
  if (!state) return null;
  return (
    <Panel title="WhatsApp">
      <form className="panel-body form-grid" onSubmit={form.onSubmit} key={`w${state.enabled}${state.app_url}${settings.whatsapp_confirm_hours}${settings.whatsapp_reminder_hours}`}>
        <label className="check full"><input type="checkbox" name="enabled" defaultChecked={state.enabled} />
          <span>Ativar envios pelo WhatsApp<span className="sub">Só ative depois de cadastrar as credenciais da Meta e ter os 3 modelos abaixo aprovados.</span></span></label>
        <Field label="Endereço do sistema (para os links)" full>
          <input className="input" name="appUrl" type="url" placeholder="https://..." defaultValue={state.app_url ?? ''} />
        </Field>
        <Field label="Pedir confirmação quantas horas antes (0 = não pedir)">
          <input className="input" name="confirm" type="number" min={0} max={168} required defaultValue={settings.whatsapp_confirm_hours} />
        </Field>
        <Field label="Lembrete quantas horas antes (0 = não lembrar)">
          <input className="input" name="reminder" type="number" min={0} max={48} required defaultValue={settings.whatsapp_reminder_hours} />
        </Field>
        <p className="muted small full">
          Só recebem mensagens os pacientes que autorizaram o WhatsApp no cadastro.
          {state.last_run_at && ` Último envio: ${dateTime(state.last_run_at)}.`}
          {state.queued > 0 && ` ${state.queued} na fila.`}
          {state.failed_today > 0 && ` ${state.failed_today} com erro nas últimas 24 h.`}
          {state.last_error && ` Último erro: ${state.last_error}`}
        </p>
        <details className="full templates">
          <summary>Modelos para cadastrar na Meta</summary>
          <ul>{TEMPLATES.map(([name, body, note]) => <li key={name}><code>{name}</code> (pt_BR, Utilidade): {body} <span className="sub">{note}</span></li>)}</ul>
        </details>
        {form.error && <p className="erro full" role="alert">{form.error}</p>}
        <div className="full"><button type="submit" className="button" disabled={form.busy}>{form.busy ? 'Salvando…' : 'Salvar'}</button></div>
      </form>
    </Panel>
  );
}

// IA (Proprietário(a)): ligar exige limite mensal; uso e custo do mês sem conteúdo clínico.
function AiPanel() {
  const notify = useToast();
  const month = new Date().toISOString().slice(0, 7) + '-01';
  const { data, reload } = useLoad(() => api.aiUsage(month), [month]);
  const form = useFormSubmit(async (values) => {
    const limitText = text(values, 'limit').replace(',', '.');
    const limit = limitText ? Number(limitText) : null;
    if (limit !== null && (!Number.isFinite(limit) || limit <= 0)) throw new Error('Limite mensal: informe um valor em dólares maior que zero.');
    await api.setAiSettings(values.get('enabled') === 'on', limit, whole(text(values, 'retention'), 1, 30, 'Prazo'));
    notify('Configuração da IA salva.');
    reload();
  });
  if (!data?.length) return null;
  const row = data[0];
  const usage = data.filter((item) => item.professional_name);
  return (
    <Panel title="Assistente de IA">
      <form className="panel-body form-grid" onSubmit={form.onSubmit} key={`ia${row.enabled}${row.monthly_limit_usd}${row.retention_days}`}>
        <label className="check full"><input type="checkbox" name="enabled" defaultChecked={row.enabled} />
          <span>Ligar o assistente de documentação com IA<span className="sub">Só ligue depois da revisão jurídica do termo de consentimento e do contrato com o fornecedor (Anthropic), e com a chave da API cadastrada no Supabase.</span></span></label>
        <Field label="Limite mensal de custo (US$)"><input className="input" name="limit" inputMode="decimal" defaultValue={row.monthly_limit_usd ?? ''} placeholder="Ex.: 30" /></Field>
        <Field label="Apagar transcrições quantos dias depois de usar ou descartar">
          <input className="input" name="retention" type="number" min={1} max={30} required defaultValue={row.retention_days} />
        </Field>
        <p className="muted small full">
          Gasto neste mês: US$ {Number(row.month_cost).toFixed(2).replace('.', ',')}{row.monthly_limit_usd ? ` de ${Number(row.monthly_limit_usd).toFixed(2).replace('.', ',')}` : ''}.
          {usage.map((item) => ` ${item.professional_name}: ${item.runs} uso(s), US$ ${Number(item.cost_usd).toFixed(2).replace('.', ',')}.`).join('')}
          {' '}O custo de cada uso vem dos tokens informados pela API (preço de tabela); a fatura oficial é a do fornecedor.
        </p>
        {form.error && <p className="erro full" role="alert">{form.error}</p>}
        <div className="full"><button type="submit" className="button" disabled={form.busy}>{form.busy ? 'Salvando…' : 'Salvar'}</button></div>
      </form>
    </Panel>
  );
}

// Aplicativo da equipe: avisos no celular. O texto na tela bloqueada é genérico (sem nome de paciente).
function PushPanel() {
  const notify = useToast();
  const { data: state, reload } = useLoad(api.pushState, []);
  const form = useFormSubmit(async (values) => {
    await api.setPushEnabled(values.get('enabled') === 'on');
    notify('Configuração dos avisos no celular salva.');
    reload();
  });
  if (!state) return null;
  return (
    <Panel title="Aplicativo da equipe">
      <form className="panel-body form-grid" onSubmit={form.onSubmit} key={`p${state.enabled}`}>
        <label className="check full"><input type="checkbox" name="enabled" defaultChecked={state.enabled} />
          <span>Enviar avisos para o celular<span className="sub">Tarefas, leads e mensagens do sino também chegam como notificação no aplicativo. Na tela bloqueada aparece só um texto genérico.</span></span></label>
        <p className="muted small full">
          {state.devices === 1 ? '1 aparelho registrado.' : `${state.devices} aparelhos registrados.`}
          {state.last_run_at && ` Último envio: ${dateTime(state.last_run_at)}.`}
          {state.queued > 0 && ` ${state.queued} na fila.`}
          {state.last_error && ` Último erro: ${state.last_error}`}
        </p>
        {form.error && <p className="erro full" role="alert">{form.error}</p>}
        <div className="full"><button type="submit" className="button" disabled={form.busy}>{form.busy ? 'Salvando…' : 'Salvar'}</button></div>
      </form>
    </Panel>
  );
}

// Portal do paciente: ligar, endereço, instruções de pagamento, quem recebe os pedidos e avisos por e-mail.
function PortalPanel() {
  const notify = useToast();
  const { data, reload } = useLoad(() => Promise.all([api.portalState(), api.taskAssignees()]), []);
  const form = useFormSubmit(async (values) => {
    await api.setPortalSettings({
      enabled: values.get('enabled') === 'on', url: text(values, 'url'), paymentInstructions: text(values, 'instructions'),
      assigneeId: text(values, 'assignee') || null, emailEnabled: values.get('email') === 'on'
    });
    notify('Configuração do portal salva.');
    reload();
  });
  if (!data?.[0]) return null;
  const [state, people] = data;
  return (
    <Panel title="Portal do paciente">
      <form className="panel-body form-grid" onSubmit={form.onSubmit}
        key={`portal${state.enabled}${state.url}${state.assignee_id}${state.email_enabled}${state.payment_instructions}`}>
        <label className="check full"><input type="checkbox" name="enabled" defaultChecked={state.enabled} />
          <span>Ligar o portal do paciente<span className="sub">Pacientes e responsáveis convidados (na ficha do paciente, aba Portal) veem sessões, cobranças e documentos compartilhados. Desligar bloqueia o acesso de todos na hora.</span></span></label>
        <Field label="Endereço do portal" full>
          <input className="input" name="url" type="url" placeholder="https://portal.renatadeazevedo.com.br" defaultValue={state.url ?? ''} />
        </Field>
        <Field label="Quem recebe os pedidos do portal (remarcar, cancelar, já paguei)" full>
          <select className="input" name="assignee" defaultValue={state.assignee_id ?? ''}>
            <option value="">Ninguém fixo (avisa a recepção e o financeiro)</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </Field>
        <Field label="Como pagar (aparece para o paciente)" full>
          <textarea className="input" name="instructions" rows={3} maxLength={2000} defaultValue={state.payment_instructions ?? ''}
            placeholder="Ex.: PIX (CNPJ) 00.000.000/0001-00, em nome de ... Depois de pagar, use o botão Já paguei." />
        </Field>
        <label className="check full"><input type="checkbox" name="email" defaultChecked={state.email_enabled} />
          <span>Avisar por e-mail<span className="sub">E-mail genérico ("há uma novidade no portal"), no máximo um por hora. Só ligue depois de configurar o envio de e-mails (veja o README).</span></span></label>
        <p className="muted small full">
          {state.active_accesses === 1 ? '1 acesso ativo.' : `${state.active_accesses} acessos ativos.`}
          {state.email_last_run_at && ` Último envio de e-mails: ${dateTime(state.email_last_run_at)}.`}
          {state.email_queued > 0 && ` ${state.email_queued} e-mail(s) na fila.`}
          {state.email_last_error && ` Último erro: ${state.email_last_error}`}
        </p>
        {form.error && <p className="erro full" role="alert">{form.error}</p>}
        <div className="full"><button type="submit" className="button" disabled={form.busy}>{form.busy ? 'Salvando…' : 'Salvar'}</button></div>
      </form>
    </Panel>
  );
}

// Segurança: exigir a verificação em duas etapas de quem tem perfil de Proprietária ou Gerência.
function SecurityPanel({ required, onSaved }: { required: boolean; onSaved: () => void }) {
  const notify = useToast();
  const form = useFormSubmit(async (values) => {
    await api.setMfaRequired(values.get('required') === 'on');
    notify('Configuração de segurança salva.');
    onSaved();
  });
  return (
    <Panel title="Segurança">
      <form className="panel-body form-grid" onSubmit={form.onSubmit} key={`mfa${required}`}>
        <label className="check full"><input type="checkbox" name="required" defaultChecked={required} />
          <span>Exigir verificação em duas etapas para Proprietária e Gerência<span className="sub">Esses perfis veem o financeiro e todos os pacientes. Ligado, quem entrar só com a senha fica sem acesso até digitar o código do app autenticador (e cadastra o app na primeira vez). Antes de ligar, ative na sua conta (menu da conta → Verificação em duas etapas) e entre de novo com o código.</span></span></label>
        {form.error && <p className="erro full" role="alert">{form.error}</p>}
        <div className="full"><button type="submit" className="button" disabled={form.busy}>{form.busy ? 'Salvando…' : 'Salvar'}</button></div>
      </form>
    </Panel>
  );
}
