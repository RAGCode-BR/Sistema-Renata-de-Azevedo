import { Select } from '../../components/Select.tsx';
import { useEffect, useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Lead, LeadAssessment, LeadDuplicate, LeadInput, LeadStage, NamedItem, Professional, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { ConfirmModal, Field, FormModal, Modal } from '../../components/Modal.tsx';
import { useToast } from '../../components/Toast.tsx';
import {
  LEAD_INTERESTS, LEAD_LOCATIONS, contactKinds, dateKey, dateTime, dayLabel, leadActivityLabel, todayKey
} from '../../format.ts';
import { errorMessage, text, useFormSubmit, useLoad } from '../../hooks.ts';

export interface CrmLists {
  stages: LeadStage[];
  sources: NamedItem[];
  reasons: NamedItem[];
  campaigns: { id: string; name: string; active: boolean }[];
  owners: { id: string; name: string }[];
  professionals: Professional[];
}

export function useCrmLists() {
  return useLoad<CrmLists>(async () => {
    const [stages, sources, reasons, campaigns, owners, professionals] = await Promise.all([
      api.leadStages(), api.leadSources(), api.lossReasons(), api.campaignOptions(), api.crmOwners(), api.professionals()
    ]);
    return { stages, sources, reasons, campaigns, owners, professionals };
  }, []);
}

export const nameOf = (items: { id: string; name: string }[], id: string | null) => (id ? items.find((item) => item.id === id)?.name ?? '—' : '—');

// Aviso de duplicidade enquanto digita telefone ou e-mail.
function useDuplicates(phone: string, email: string, exclude: string | null) {
  const [found, setFound] = useState<LeadDuplicate[]>([]);
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 && !email.includes('@')) { setFound([]); return; }
    const timer = setTimeout(() => {
      api.leadDuplicates(phone, email, exclude).then(setFound, () => setFound([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [phone, email, exclude]);
  return found;
}

export function LeadForm({ user, lead, lists, onClose, onSaved }: {
  user: SessionUser; lead: Lead | null; lists: CrmLists; onClose: () => void; onSaved: (id: string) => void;
}) {
  const notify = useToast();
  const [phone, setPhone] = useState(lead?.phone ?? '');
  const [email, setEmail] = useState(lead?.email ?? '');
  const duplicates = useDuplicates(phone, email, lead?.id ?? null);
  const active = <T extends { active: boolean; id: string }>(items: T[], current: string | null | undefined) =>
    items.filter((item) => item.active || item.id === current);

  return (
    <FormModal title={lead ? 'Editar lead' : 'Novo lead'} submitLabel={lead ? 'Salvar' : 'Cadastrar lead'} onClose={onClose} onSubmit={async (data) => {
      const input: LeadInput = {
        name: text(data, 'name'), phone, email, source_id: text(data, 'source'), campaign_id: text(data, 'campaign'),
        interest: text(data, 'interest'), location: text(data, 'location'), preferred_professional_id: text(data, 'professional'),
        owner_id: text(data, 'owner'), notes: text(data, 'notes')
      };
      if (!input.phone.trim() && !input.email.trim()) throw new Error('Informe telefone ou e-mail.');
      const id = await api.saveLead(lead?.id ?? null, input);
      notify(lead ? 'Lead atualizado.' : 'Lead cadastrado.');
      onSaved(id);
    }}>
      <Field label="Nome" full><input className="input" name="name" required maxLength={200} defaultValue={lead?.name} /></Field>
      <Field label="Telefone / WhatsApp">
        <input className="input" name="phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(21) 99999-0000" />
      </Field>
      <Field label="E-mail">
        <input className="input" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      </Field>
      {duplicates.length > 0 && (
        <div className="notice full" role="status">
          Já existe cadastro com este contato:{' '}
          {duplicates.map((item, index) => (
            <span key={item.id}>{index > 0 && ', '}
              <a href={item.kind === 'lead' ? `#/comercial?lead=${item.id}` : `#/pacientes?id=${item.id}`} target="_blank" rel="noreferrer">
                {item.name}</a> ({item.kind === 'lead' ? `lead, ${item.detail}` : 'paciente'})
            </span>
          ))}
        </div>
      )}
      <Field label="Origem">
        <Select className="input" name="source" defaultValue={lead?.source_id ?? ''}>
          <option value="">Não informada</option>
          {active(lists.sources, lead?.source_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      <Field label="Campanha">
        <Select className="input" name="campaign" defaultValue={lead?.campaign_id ?? ''}>
          <option value="">Nenhuma</option>
          {active(lists.campaigns, lead?.campaign_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      <Field label="Interesse">
        <input className="input" name="interest" list="lead-interesses" maxLength={120} defaultValue={lead?.interest ?? ''} />
        <datalist id="lead-interesses">{LEAD_INTERESTS.map((item) => <option key={item} value={item} />)}</datalist>
      </Field>
      <Field label="Local">
        <input className="input" name="location" list="lead-locais" maxLength={120} defaultValue={lead?.location ?? ''} />
        <datalist id="lead-locais">{LEAD_LOCATIONS.map((item) => <option key={item} value={item} />)}</datalist>
      </Field>
      <Field label="Profissional desejada (opcional)">
        <Select className="input" name="professional" defaultValue={lead?.preferred_professional_id ?? ''}>
          <option value="">Sem preferência</option>
          {lists.professionals.filter((item) => item.active || item.id === lead?.preferred_professional_id)
            .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      <Field label="Responsável">
        <Select className="input" name="owner" defaultValue={lead ? lead.owner_id ?? '' : user.id}>
          <option value="">Sem responsável</option>
          {lists.owners.map((item) => <option key={item.id} value={item.id}>{item.id === user.id ? `${item.name} (eu)` : item.name}</option>)}
        </Select>
      </Field>
      <Field label="Observações" full><textarea className="input" name="notes" rows={3} maxLength={4000} defaultValue={lead?.notes ?? ''} /></Field>
    </FormModal>
  );
}

type Dialog = 'edit' | 'lost' | 'convert' | 'followup' | 'cancel_followup' | 'assessment' | null;
export const followupLabel = (lead: Lead) => lead.next_contact_at
  ? `${dayLabel(lead.next_contact_at)}${lead.next_contact_time ? ` às ${lead.next_contact_time.slice(0, 5)}` : ''}` : '—';

// Detalhe do lead: dados, etapa, contatos (linha do tempo), retorno, perda e conversão em paciente.
export function LeadDetail({ user, leadId, lists, onClose, onChanged }: {
  user: SessionUser; leadId: string; lists: CrmLists; onClose: () => void; onChanged: () => void;
}) {
  const notify = useToast();
  const manage = can(user, 'crm.manage');
  const { data, error, reload } = useLoad(() => Promise.all([api.lead(leadId), api.leadActivities(leadId), api.leadAssessments(leadId)]), [leadId]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [assessmentAction, setAssessmentAction] = useState<{ item: LeadAssessment; status: 'attended' | 'missed' | 'cancelled' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lead, activities, assessments] = data ?? [null, [], []];
  const scheduledAssessment = assessments.find((item) => item.status === 'scheduled');
  const stage = lists.stages.find((item) => item.id === lead?.stage_id);
  const contact = useFormSubmit(async (form) => {
    await api.addLeadActivity(leadId, text(form, 'kind'), text(form, 'body'));
    reload();
    onChanged();
  });
  const refresh = () => { reload(); onChanged(); };

  async function move(stageId: string) {
    const target = lists.stages.find((item) => item.id === stageId);
    if (!target || target.id === lead?.stage_id) return;
    if (target.kind === 'lost') { setDialog('lost'); return; }
    if (target.kind === 'won') { setDialog('convert'); return; }
    setBusy(true);
    try {
      await api.moveLead(leadId, stageId, null, '');
      notify(`Lead em "${target.name}".`);
      refresh();
    } catch (failure) {
      notify(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (dialog === 'edit' && lead) return <LeadForm user={user} lead={lead} lists={lists} onClose={() => setDialog(null)} onSaved={refresh} />;
  if (dialog === 'lost' && lead) {
    return (
      <FormModal title="Marcar como perdido" submitLabel="Marcar como perdido" onClose={() => setDialog(null)} onSubmit={async (form) => {
        await api.moveLead(leadId, lists.stages.find((item) => item.kind === 'lost')!.id, text(form, 'reason'), text(form, 'note'));
        notify('Lead marcado como perdido.');
        refresh();
      }}>
        <Field label="Motivo">
          <Select className="input" name="reason" required defaultValue="">
            <option value="" disabled>Escolha</option>
            {lists.reasons.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </Field>
        <Field label="Detalhe (opcional)" full><input className="input" name="note" maxLength={300} /></Field>
      </FormModal>
    );
  }
  if (dialog === 'convert' && lead) return <ConvertForm lead={lead} lists={lists} onClose={() => setDialog(null)} onDone={refresh} />;
  if (dialog === 'assessment' && lead) return <FormModal title="Agendar avaliação" submitLabel="Reservar horário" onClose={() => setDialog(null)}
    onSubmit={async (form) => {
      const start = new Date(text(form, 'startsAt'));
      const duration = Number(text(form, 'duration'));
      if (Number.isNaN(start.getTime())) throw new Error('Informe a data e o horário.');
      await api.scheduleLeadAssessment(lead.id, text(form, 'professional'), start.toISOString(),
        new Date(start.getTime() + duration * 60_000).toISOString());
      notify('Avaliação reservada na agenda.'); refresh();
    }}>
    <p className="modal-text full">Reserve uma avaliação para {lead.name}. O lead continua no funil até a conversão. O horário aparece na agenda da profissional.</p>
    <Field label="Profissional"><Select className="input" name="professional" required defaultValue={lead.preferred_professional_id ?? ''}>
      <option value="" disabled>Selecione</option>
      {lists.professionals.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
    </Select></Field>
    <Field label="Data e horário"><input className="input" name="startsAt" type="datetime-local" required /></Field>
    <Field label="Duração"><Select className="input" name="duration" defaultValue="50">
      {[30, 45, 50, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}
    </Select></Field>
    <p className="muted small full">Ao converter o lead antes da avaliação, a reserva vira uma sessão de avaliação do paciente no mesmo horário.</p>
  </FormModal>;
  if (dialog === 'followup' && lead) {
    return (
      <FormModal title="Agendar retorno" submitLabel="Agendar" onClose={() => setDialog(null)} onSubmit={async (form) => {
        await api.scheduleFollowup(leadId, text(form, 'date'), text(form, 'time') || null, text(form, 'assignee'));
        notify('Retorno agendado no Comercial.');
        refresh();
      }}>
        <Field label="Data"><input className="input" name="date" type="date" required min={todayKey()} defaultValue={lead.next_contact_at ?? todayKey()} /></Field>
        <Field label="Horário (opcional)"><input className="input" name="time" type="time" defaultValue={lead.next_contact_time?.slice(0, 5) ?? ''} /></Field>
        <Field label="Responsável pelo retorno" full><Select className="input" name="assignee" required defaultValue={lead.next_contact_owner_id ?? lead.owner_id ?? user.id}>
          {lists.owners.map((item) => <option key={item.id} value={item.id}>{item.name}{item.id === user.id ? ' (eu)' : ''}</option>)}
        </Select></Field>
        <p className="muted small full">O retorno de {lead.name} aparecerá no Comercial até que um novo contato seja registrado ou o retorno seja cancelado.</p>
      </FormModal>
    );
  }
  if (dialog === 'cancel_followup' && lead) return <FormModal title="Cancelar retorno" submitLabel="Cancelar retorno"
    onClose={() => setDialog(null)} onSubmit={async (form) => {
      await api.cancelLeadFollowup(leadId, text(form, 'reason'));
      notify('Retorno cancelado.'); refresh();
    }}>
    <p className="modal-text full">O cancelamento ficará no histórico do contato.</p>
    <Field label="Motivo (opcional)" full><input className="input" name="reason" maxLength={4000} /></Field>
  </FormModal>;

  return (
    <>
    <Modal title={lead?.name ?? 'Lead'} onClose={onClose}>
      <div className="modal-body task-detail">
        {!data && <p className={error ? 'erro' : 'muted'} role={error ? 'alert' : undefined}>{error || 'Carregando…'}</p>}
        {data && !lead && <p className="muted">Lead não encontrado.</p>}
        {lead && stage && <>
          <div className="lead-stage-row">
            <label className="field-inline">Etapa
              <Select className="input compact" value={lead.stage_id} disabled={!manage || busy || Boolean(lead.patient_id)}
                onChange={(event) => move(event.target.value)}>
                {lists.stages.filter((item) => item.active || item.id === lead.stage_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </label>
            {lead.loss_reason_id && <span className="st charge-overdue">Motivo: {nameOf(lists.reasons, lead.loss_reason_id)}</span>}
          </div>
          <dl className="facts">
            <dt>Telefone</dt><dd>{lead.phone ? <a href={`https://wa.me/${whatsapp(lead.phone)}`} target="_blank" rel="noreferrer">{lead.phone}</a> : '—'}</dd>
            <dt>E-mail</dt><dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : '—'}</dd>
            <dt>Origem</dt><dd>{nameOf(lists.sources, lead.source_id)}{lead.campaign_id && ` · ${nameOf(lists.campaigns, lead.campaign_id)}`}</dd>
            <dt>Interesse</dt><dd>{[lead.interest, lead.location].filter(Boolean).join(' · ') || '—'}</dd>
            {lead.preferred_professional_id && <><dt>Profissional</dt><dd>{nameOf(lists.professionals, lead.preferred_professional_id)}</dd></>}
            <dt>Responsável</dt><dd>{nameOf(lists.owners, lead.owner_id)}</dd>
            <dt>Entrou em</dt><dd>{dateTime(lead.created_at)}{lead.consent_at && ' · autorizou contato'}</dd>
            {lead.next_contact_at && <><dt>Retorno</dt><dd><strong className={lead.next_contact_at < todayKey() ? 'text-danger' : undefined}>{followupLabel(lead)}</strong>
              {lead.next_contact_owner_id && ` · ${nameOf(lists.owners, lead.next_contact_owner_id)}`}</dd></>}
            {lead.utm_campaign && <><dt>Link</dt><dd>{[lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean).join(' / ')}</dd></>}
            {lead.patient_id && <><dt>Paciente</dt><dd><a href={`#/pacientes?id=${lead.patient_id}`}>Abrir cadastro</a> · <a href="#/agenda">Agendar sessão</a></dd></>}
          </dl>
          {assessments.length > 0 && <section className="lead-assessments">
            <h3 className="task-section">Avaliações</h3>
            {assessments.map((item) => <div key={item.id} className="lead-assessment-row">
              <span><strong>{dateTime(item.starts_at)}</strong> · {item.professional_name}<span className="sub">
                {item.status === 'scheduled' ? (new Date(item.ends_at).getTime() <= Date.now() ? 'Já passou: registre se compareceu ou faltou' : 'Agendada') : item.status === 'attended' ? 'Compareceu' : item.status === 'missed' ? 'Faltou'
                  : item.status === 'converted' ? 'Virou sessão do paciente' : 'Cancelada'}</span></span>
              <span className="lead-assessment-actions">
                {item.status === 'scheduled' && <a className="link-btn" href={`#/agenda?data=${dateKey(new Date(item.starts_at))}`}>Ver agenda</a>}
                {item.appointment_id && <a className="link-btn" href={`#/agenda?data=${dateKey(new Date(item.starts_at))}&sessao=${item.appointment_id}`}>Abrir sessão</a>}
                {manage && item.status === 'scheduled' && <>
                  {new Date(item.ends_at).getTime() <= Date.now() && <>
                    <button type="button" className="link-btn" onClick={() => setAssessmentAction({ item, status: 'attended' })}>Compareceu</button>
                    <button type="button" className="link-btn" onClick={() => setAssessmentAction({ item, status: 'missed' })}>Faltou</button>
                  </>}
                  <button type="button" className="link-btn danger" onClick={() => setAssessmentAction({ item, status: 'cancelled' })}>Cancelar</button>
                </>}
              </span>
            </div>)}
          </section>}
          {lead.notes && <p className="pre task-description">{lead.notes}</p>}

          {manage && (
            <div className="task-actions">
              {!lead.patient_id && <button type="button" className="button" onClick={() => setDialog('convert')}>Converter em paciente</button>}
              {!lead.patient_id && stage.kind === 'open' && !scheduledAssessment && <button type="button" className="button light" onClick={() => setDialog('assessment')}>Agendar avaliação</button>}
              {!lead.patient_id && stage.kind === 'open' && <button type="button" className="button light" onClick={() => setDialog('followup')}>{lead.next_contact_at ? 'Reagendar retorno' : 'Agendar retorno'}</button>}
              {lead.next_contact_at && <button type="button" className="link-btn danger" onClick={() => setDialog('cancel_followup')}>Cancelar retorno</button>}
              <button type="button" className="link-btn" onClick={() => setDialog('edit')}>Editar</button>
              {!lead.patient_id && stage.kind !== 'lost' && <button type="button" className="link-btn danger" onClick={() => setDialog('lost')}>Marcar como perdido</button>}
            </div>
          )}

          {manage && (
            <form key={activities.length} className="lead-contact" onSubmit={contact.onSubmit}>
              <Select className="input compact" name="kind" aria-label="Tipo de contato" defaultValue="message">
                {contactKinds.map((kind) => <option key={kind} value={kind}>{leadActivityLabel[kind].charAt(0).toUpperCase() + leadActivityLabel[kind].slice(1)}</option>)}
              </Select>
              <input className="input" name="body" maxLength={4000} placeholder="O que foi conversado (opcional)" aria-label="Descrição do contato" />
              <button type="submit" className="button light" disabled={contact.busy}>{contact.busy ? 'Salvando…' : 'Registrar'}</button>
              {contact.error && <p className="erro full" role="alert">{contact.error}</p>}
            </form>
          )}

          <h3 className="task-section">Linha do tempo</h3>
          <ol className="task-history">
            {[...activities].reverse().map((item) => (
              <li key={item.id}>
                <span><b>{item.actor_id ? nameOf(lists.owners, item.actor_id) : 'Site'}</b> {activityText(item.kind, item.from_value, item.to_value)}</span>
                <time className="sub">{dateTime(item.created_at)}</time>
                {item.body && <p className="pre comment">{item.body}</p>}
              </li>
            ))}
          </ol>
        </>}
      </div>
    </Modal>
      {assessmentAction && <ConfirmModal title={assessmentAction.status === 'cancelled' ? 'Cancelar avaliação' : 'Registrar resultado da avaliação'}
        confirmLabel={assessmentAction.status === 'attended' ? 'Confirmar comparecimento' : assessmentAction.status === 'missed' ? 'Confirmar falta' : 'Cancelar avaliação'}
        onClose={() => setAssessmentAction(null)} onConfirm={async () => {
          await api.setLeadAssessmentStatus(assessmentAction.item.id, assessmentAction.status);
          notify('Avaliação atualizada.'); refresh();
        }}>
        <p className="modal-text">{assessmentAction.item.professional_name} · {dateTime(assessmentAction.item.starts_at)}. O resultado ficará no histórico comercial.</p>
      </ConfirmModal>}
    </>
  );
}

export function activityText(kind: string, from: string | null, to: string | null): string {
  if (kind === 'stage') return `mudou a etapa de ${from ?? '—'} para ${to ?? '—'}`;
  if (kind === 'assigned') return `passou de ${from ?? 'ninguém'} para ${to ?? 'ninguém'}`;
  if (kind === 'followup') return `agendou retorno para ${dayLabel(to?.slice(0, 10) ?? null)}${to && to.length > 10 ? ` às ${to.slice(11, 16)}` : ''}`;
  if (kind === 'followup_done') return `concluiu o retorno de ${dayLabel(from?.slice(0, 10) ?? null)}`;
  if (kind === 'followup_cancelled') return `cancelou o retorno de ${dayLabel(from?.slice(0, 10) ?? null)}`;
  if (kind === 'assessment_scheduled') return `agendou avaliação para ${to ?? '—'}`;
  if (['call', 'message', 'email', 'meeting', 'note'].includes(kind)) return `registrou ${leadActivityLabel[kind]}`;
  return leadActivityLabel[kind] ?? kind;
}

// wa.me precisa do número com DDI.
function whatsapp(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 11 ? `55${digits}` : digits;
}

function ConvertForm({ lead, lists, onClose, onDone }: { lead: Lead; lists: CrmLists; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const duplicates = useDuplicates(lead.phone ?? '', lead.email ?? '', lead.id).filter((item) => item.kind === 'patient');
  const [existing, setExisting] = useState('');
  return (
    <FormModal title="Converter em paciente" submitLabel="Converter" onClose={onClose} onSubmit={async (form) => {
      const professionals = form.getAll('professionals').map(String);
      if (!existing && !professionals.length) throw new Error('Escolha a profissional responsável.');
      const patientId = await api.convertLead(lead.id, existing || null, professionals);
      notify('Lead convertido. Agende a primeira sessão na Agenda.');
      onDone();
      window.location.hash = `#/pacientes?id=${patientId}`;
    }}>
      <p className="modal-text full">Cria o cadastro de {lead.name} com telefone, e-mail, origem e campanha do lead.</p>
      {duplicates.length > 0 && (
        <Field label="Já é paciente?" full>
          <Select className="input" value={existing} onChange={(event) => setExisting(event.target.value)}>
            <option value="">Não, criar novo cadastro</option>
            {duplicates.map((item) => <option key={item.id} value={item.id}>Ligar a {item.name} (mesmo contato)</option>)}
          </Select>
        </Field>
      )}
      {/* Paciente existente: nada vem marcado, para não dar acesso ao cadastro dele sem querer. A chave recria as caixas ao trocar. */}
      <fieldset key={existing ? 'existente' : 'novo'} className="full checks">
        <legend>{existing ? 'Adicionar profissional ao paciente (opcional)' : 'Profissional responsável'}</legend>
        {existing && <p className="muted small">A profissional marcada passa a ver o cadastro, a agenda e o portal deste paciente.</p>}
        {lists.professionals.filter((item) => item.active).map((item) => (
          <label key={item.id} className="check">
            <input type="checkbox" name="professionals" value={item.id} defaultChecked={!existing && item.id === lead.preferred_professional_id} />
            <span>{item.name}</span>
          </label>
        ))}
      </fieldset>
    </FormModal>
  );
}
