import { useState } from 'react';
import type { AppointmentStatus, PortalAppointment, PortalCharge, PortalMe } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field, FormModal } from '../components/Modal.tsx';
import { Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { chargeStatusLabel, dateOnly, dateTime, fileSize, longDay, modalityLabel, money, paymentMethodLabel, time } from '../format.ts';
import { errorMessage, text, useLoad } from '../hooks.ts';

// Situação da sessão na linguagem do paciente.
const STATUS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendada', awaiting_confirmation: 'Aguardando sua confirmação', confirmed: 'Confirmada', completed: 'Realizada',
  missed: 'Não compareceu', cancelled_by_patient: 'Cancelada', cancelled_by_clinic: 'Cancelada pela clínica', rescheduled: 'Remarcada'
};
const OPEN = ['pending', 'partial', 'overdue', 'unpriced'];
const isUpcoming = (item: PortalAppointment) =>
  new Date(item.ends_at).getTime() > Date.now() && ['scheduled', 'awaiting_confirmation', 'confirmed'].includes(item.status);

export function Home({ me, patient }: { me: PortalMe; patient: PortalMe['patients'][number] }) {
  const { data, error } = useLoad(() => Promise.all([api.portalAppointments(patient.id), api.portalCharges(patient.id)]), [patient.id]);
  const [appointments, charges] = data ?? [[], []];
  const next = appointments.find(isUpcoming);
  const open = charges.filter((item) => OPEN.includes(item.status));
  const due = open.reduce((sum, item) => sum + (item.balance ?? 0), 0);
  const first = (me.name ?? '').split(' ')[0];

  return (
    <>
      <h1 className="portal-title">Olá{first ? `, ${first}` : ''}!</h1>
      {patient.relationship === 'guardian' && <p className="muted portal-lead">Você acompanha {patient.name} como responsável.</p>}
      {!data ? <PanelState error={error} loading={!error} empty="" /> : (
        <div className="portal-cards">
          <a className="portal-card" href="#/portal/consultas">
            <span className="muted small">Próxima sessão</span>
            {next ? (
              <>
                <strong className="first-up">{longDay(next.starts_at)}, {time(next.starts_at)}</strong>
                <span>{next.professional_name} · {modalityLabel[next.modality].toLowerCase()}</span>
                <span className={next.can_confirm ? 'st st-awaiting_confirmation' : 'st'}>{STATUS[next.status]}</span>
              </>
            ) : <strong>Nenhuma sessão marcada</strong>}
          </a>
          <a className="portal-card" href="#/portal/financeiro">
            <span className="muted small">Em aberto</span>
            <strong>{open.length ? money(due) : 'Nada em aberto'}</strong>
            {open.some((item) => item.status === 'overdue') && <span className="erro">Há cobrança vencida</span>}
            {open.some((item) => item.status === 'unpriced') && <span className="muted small">Inclui valor ainda a definir</span>}
          </a>
        </div>
      )}
    </>
  );
}

export function Appointments({ patientId }: { patientId: string }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(() => api.portalAppointments(patientId), [patientId]);
  const [requesting, setRequesting] = useState<PortalAppointment | null>(null);
  const [busy, setBusy] = useState('');
  const items = data ?? [];
  const upcoming = items.filter((item) => new Date(item.ends_at).getTime() > Date.now());
  const past = items.filter((item) => new Date(item.ends_at).getTime() <= Date.now()).reverse();

  async function confirm(item: PortalAppointment) {
    setBusy(item.id);
    try {
      await api.portalConfirm(item.id);
      notify('Sessão confirmada. Obrigado!');
      reload();
    } catch (failure) {
      notify(errorMessage(failure));
    } finally {
      setBusy('');
    }
  }

  const card = (item: PortalAppointment) => (
    <li key={item.id} className="portal-item">
      <div>
        <strong className="first-up">{longDay(item.starts_at)}</strong>
        <span>{time(item.starts_at)}–{time(item.ends_at)} · {item.professional_name} · {modalityLabel[item.modality].toLowerCase()}</span>
        <span className={`st st-${item.status}`}>{STATUS[item.status]}{item.requested ? ' · pedido de alteração enviado' : ''}</span>
      </div>
      {(item.meeting_url || item.can_confirm || item.can_request) && (
        <div className="portal-actions">
          {item.meeting_url && <a className="button" href={item.meeting_url} target="_blank" rel="noreferrer">Entrar na sessão on-line</a>}
          {item.can_confirm && <button type="button" className="button" disabled={busy === item.id} onClick={() => confirm(item)}>
            {busy === item.id ? 'Confirmando…' : 'Confirmar presença'}</button>}
          {item.can_request && <button type="button" className="button light" onClick={() => setRequesting(item)}>Preciso remarcar ou cancelar</button>}
        </div>
      )}
    </li>
  );

  return (
    <>
      <h1 className="portal-title">Sessões</h1>
      <Panel title="Próximas">
        {upcoming.length ? <ul className="portal-list">{upcoming.map(card)}</ul>
          : <PanelState error={error} loading={!data} empty="Nenhuma sessão marcada." />}
      </Panel>
      {past.length > 0 && (
        <Panel title="Anteriores">
          <ul className="portal-list">{past.map(card)}</ul>
        </Panel>
      )}
      <p className="muted small">O link da sessão on-line aparece aqui 1 hora antes do horário.</p>

      {requesting && (
        <FormModal title="Remarcar ou cancelar" submitLabel="Enviar pedido" onClose={() => setRequesting(null)}
          onSubmit={async (form) => {
            await api.portalRequestChange(requesting.id, text(form, 'kind') === 'cancel' ? 'cancel' : 'reschedule', text(form, 'message'));
            notify('Pedido enviado. A clínica vai entrar em contato.');
            reload();
          }}>
          <p className="modal-text full">Sessão de {longDay(requesting.starts_at)}, {time(requesting.starts_at)}. O pedido não altera a agenda sozinho: a equipe entra em contato para combinar.</p>
          <fieldset className="full portal-choice">
            <legend className="sr-only">O que você precisa</legend>
            <label className="check"><input type="radio" name="kind" value="reschedule" defaultChecked /> Remarcar para outro horário</label>
            <label className="check"><input type="radio" name="kind" value="cancel" /> Cancelar esta sessão</label>
          </fieldset>
          <Field label="Mensagem para a clínica (opcional)" full>
            <textarea className="input" name="message" rows={3} maxLength={1000} placeholder="Ex.: prefiro horários à tarde." />
          </Field>
          <p className="muted small full">Cancelamentos com pouca antecedência podem ser cobrados, conforme a política da clínica.</p>
        </FormModal>
      )}
    </>
  );
}

export function Finance({ patientId, instructions }: { patientId: string; instructions: string | null }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(() => Promise.all([api.portalCharges(patientId), api.portalPayments(patientId)]), [patientId]);
  const [charges, payments] = data ?? [[], []];
  const [informing, setInforming] = useState<PortalCharge | null>(null);
  const open = charges.filter((item) => OPEN.includes(item.status));
  const paid = charges.filter((item) => item.status === 'paid');

  const row = (item: PortalCharge) => (
    <li key={item.id} className="portal-item">
      <div>
        <strong>{item.description}</strong>
        <span>Vencimento {dateOnly(item.due_date)}{item.amount !== null && ` · valor ${money(item.amount - item.discount)}`}
          {item.paid > 0 && item.status !== 'paid' && ` · pago ${money(item.paid)}`}</span>
        <span className={`st charge-${item.status}`}>
          {item.status === 'unpriced' ? 'Valor a definir pela clínica' : item.status === 'paid' ? 'Paga' : `${chargeStatusLabel[item.status]} · falta ${money(item.balance)}`}
        </span>
        {item.paid_notice_at && item.status !== 'paid' && <span className="muted small">Você avisou o pagamento em {dateTime(item.paid_notice_at)}. O financeiro vai conferir.</span>}
      </div>
      {item.status !== 'paid' && item.status !== 'unpriced' && !item.paid_notice_at && (
        <div className="portal-actions">
          <button type="button" className="button light" onClick={() => setInforming(item)}>Já paguei</button>
        </div>
      )}
    </li>
  );

  return (
    <>
      <h1 className="portal-title">Financeiro</h1>
      {instructions && (
        <Panel title="Como pagar">
          <p className="panel-body pre">{instructions}</p>
        </Panel>
      )}
      <Panel title="Em aberto">
        {open.length ? <ul className="portal-list">{open.map(row)}</ul> : <PanelState error={error} loading={!data} empty="Nada em aberto." />}
      </Panel>
      {payments.length > 0 && (
        <Panel title="Pagamentos recebidos">
          <ul className="portal-list">
            {payments.map((item) => (
              <li key={item.id} className="portal-item">
                <div>
                  <strong>{money(item.amount)}</strong>
                  <span>{dateOnly(item.received_at)} · {paymentMethodLabel[item.method] ?? item.method}</span>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {paid.length > 0 && (
        <Panel title="Cobranças pagas">
          <ul className="portal-list">{paid.map(row)}</ul>
        </Panel>
      )}

      {informing && (
        <FormModal title="Avisar pagamento" submitLabel="Enviar aviso" onClose={() => setInforming(null)}
          onSubmit={async (form) => {
            await api.portalNotifyPaid(informing.id, text(form, 'message'));
            notify('Aviso enviado. O financeiro vai conferir o pagamento.');
            reload();
          }}>
          <p className="modal-text full">{informing.description}: falta {money(informing.balance)}. O financeiro confere o recebimento e dá baixa; até lá a cobrança continua em aberto.</p>
          <Field label="Mensagem (opcional)" full>
            <textarea className="input" name="message" rows={3} maxLength={1000} placeholder="Ex.: paguei por PIX hoje às 10h." />
          </Field>
        </FormModal>
      )}
    </>
  );
}

export function Documents({ patientId }: { patientId: string }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(() => api.portalDocuments(patientId), [patientId]);
  const [opening, setOpening] = useState('');

  async function open(id: string) {
    setOpening(id);
    // A aba é aberta já no clique (navegadores bloqueiam janelas abertas depois de uma espera).
    const tab = window.open('', '_blank');
    try {
      const url = await api.portalDocumentUrl(id);
      if (tab) tab.location.href = url; else window.location.href = url;
      reload();
    } catch (failure) {
      tab?.close();
      notify(errorMessage(failure));
    } finally {
      setOpening('');
    }
  }

  return (
    <>
      <h1 className="portal-title">Documentos</h1>
      <Panel title="Compartilhados pela clínica">
        {data?.length ? (
          <ul className="portal-list">
            {data.map((item) => (
              <li key={item.id} className="portal-item">
                <div>
                  <strong>{item.title}{!item.downloaded && <span className="tag-new">novo</span>}</strong>
                  <span>{dateOnly(item.created_at)}{item.size_bytes ? ` · ${fileSize(item.size_bytes)}` : ''}</span>
                </div>
                <div className="portal-actions">
                  <button type="button" className="button light" disabled={opening === item.id} onClick={() => open(item.id)}>
                    {opening === item.id ? 'Abrindo…' : 'Abrir'}</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <PanelState error={error} loading={!data} empty="Nenhum documento compartilhado." />}
      </Panel>
    </>
  );
}

export function Notices() {
  const { data, error, reload } = useLoad(api.notifications, []);
  const unread = (data ?? []).filter((item) => !item.read_at);

  return (
    <>
      <h1 className="portal-title">Avisos</h1>
      <Panel title="Recentes" tools={unread.length > 0 && (
        <button type="button" className="link-btn" onClick={async () => { await api.markNotificationsRead(); reload(); }}>Marcar como lidos</button>
      )}>
        {data?.length ? (
          <ul className="portal-list">
            {data.map((item) => (
              <li key={item.id} className={item.read_at ? 'portal-item' : 'portal-item unread'}>
                <a href={item.link ?? '#/portal/inicio'} onClick={() => { if (!item.read_at) api.markNotificationsRead([item.id]); }}>
                  <strong>{item.title}</strong>
                  <span className="muted small">{dateTime(item.created_at)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : <PanelState error={error} loading={!data} empty="Nenhum aviso." />}
      </Panel>
    </>
  );
}
