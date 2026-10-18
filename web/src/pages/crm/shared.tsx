import { useEffect, useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Lead, LeadDuplicate, LeadInput, LeadStage, NamedItem, Professional, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal, Modal } from '../../components/Modal.tsx';
import { useToast } from '../../components/Toast.tsx';
import {
  LEAD_INTERESTS, LEAD_LOCATIONS, contactKinds, dateTime, dayLabel, leadActivityLabel, todayKey
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
        <select className="input" name="source" defaultValue={lead?.source_id ?? ''}>
          <option value="">Não informada</option>
          {active(lists.sources, lead?.source_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="Campanha">
        <select className="input" name="campaign" defaultValue={lead?.campaign_id ?? ''}>
          <option value="">Nenhuma</option>
          {active(lists.campaigns, lead?.campaign_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
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
        <select className="input" name="professional" defaultValue={lead?.preferred_professional_id ?? ''}>
          <option value="">Sem preferência</option>
          {lists.professionals.filter((item) => item.active || item.id === lead?.preferred_professional_id)
            .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="Responsável">
        <select className="input" name="owner" defaultValue={lead ? lead.owner_id ?? '' : user.id}>
          <option value="">Sem responsável</option>
          {lists.owners.map((item) => <option key={item.id} value={item.id}>{item.id === user.id ? `${item.name} (eu)` : item.name}</option>)}
        </select>
      </Field>
      <Field label="Observações" full><textarea className="input" name="notes" rows={3} maxLength={4000} defaultValue={lead?.notes ?? ''} /></Field>
    </FormModal>
  );
}

type Dialog = 'edit' | 'lost' | 'convert' | 'followup' | null;

// Detalhe do lead: dados, etapa, contatos (linha do tempo), retorno, perda e conversão em paciente.
export function LeadDetail({ user, leadId, lists, onClose, onChanged }: {
  user: SessionUser; leadId: string; lists: CrmLists; onClose: () => void; onChanged: () => void;
}) {
  const notify = useToast();
  const manage = can(user, 'crm.manage');
  const { data, error, reload } = useLoad(() => Promise.all([api.lead(leadId), api.leadActivities(leadId)]), [leadId]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [lead, activities] = data ?? [null, []];
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
          <select className="input" name="reason" required defaultValue="">
            <option value="" disabled>Escolha</option>
            {lists.reasons.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
        <Field label="Detalhe (opcional)" full><input className="input" name="note" maxLength={300} /></Field>
      </FormModal>
    );
  }
  if (dialog === 'convert' && lead) return <ConvertForm lead={lead} lists={lists} onClose={() => setDialog(null)} onDone={refresh} />;
  if (dialog === 'followup' && lead) {
    return (
      <FormModal title="Agendar retorno" submitLabel="Agendar" onClose={() => setDialog(null)} onSubmit={async (form) => {
        await api.scheduleFollowup(leadId, text(form, 'date'), text(form, 'time') || null, user.id);
        notify('Retorno agendado: a tarefa está em Minhas tarefas.');
        refresh();
      }}>
        <Field label="Data"><input className="input" name="date" type="date" required min={todayKey()} defaultValue={todayKey()} /></Field>
        <Field label="Horário (opcional)"><input className="input" name="time" type="time" /></Field>
        <p className="muted small full">Cria a tarefa "Retornar contato: {lead.name}" para você.</p>
      </FormModal>
    );
  }

  return (
    <Modal title={lead?.name ?? 'Lead'} onClose={onClose}>
      <div className="modal-body task-detail">
        {!data && <p className={error ? 'erro' : 'muted'} role={error ? 'alert' : undefined}>{error || 'Carregando…'}</p>}
        {data && !lead && <p className="muted">Lead não encontrado.</p>}
        {lead && stage && <>
          <div className="lead-stage-row">
            <label className="field-inline">Etapa
              <select className="input compact" value={lead.stage_id} disabled={!manage || busy || Boolean(lead.patient_id)}
                onChange={(event) => move(event.target.value)}>
                {lists.stages.filter((item) => item.active || item.id === lead.stage_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
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
            {lead.next_contact_at && <><dt>Retorno</dt><dd>{dayLabel(lead.next_contact_at)}</dd></>}
            {lead.utm_campaign && <><dt>Link</dt><dd>{[lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean).join(' / ')}</dd></>}
            {lead.patient_id && <><dt>Paciente</dt><dd><a href={`#/pacientes?id=${lead.patient_id}`}>Abrir cadastro</a> · <a href="#/agenda">Agendar sessão</a></dd></>}
          </dl>
          {lead.notes && <p className="pre task-description">{lead.notes}</p>}

          {manage && (
            <div className="task-actions">
              {!lead.patient_id && <button type="button" className="button" onClick={() => setDialog('convert')}>Converter em paciente</button>}
              {!lead.patient_id && <button type="button" className="button light" onClick={() => setDialog('followup')}>Agendar retorno</button>}
              <button type="button" className="link-btn" onClick={() => setDialog('edit')}>Editar</button>
              {!lead.patient_id && stage.kind !== 'lost' && <button type="button" className="link-btn danger" onClick={() => setDialog('lost')}>Marcar como perdido</button>}
            </div>
          )}

          {manage && (
            <form className="lead-contact" onSubmit={contact.onSubmit}>
              <select className="input compact" name="kind" aria-label="Tipo de contato" defaultValue="message">
                {contactKinds.map((kind) => <option key={kind} value={kind}>{leadActivityLabel[kind].charAt(0).toUpperCase() + leadActivityLabel[kind].slice(1)}</option>)}
              </select>
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
  );
}

function activityText(kind: string, from: string | null, to: string | null): string {
  if (kind === 'stage') return `mudou a etapa de ${from ?? '—'} para ${to ?? '—'}`;
  if (kind === 'assigned') return `passou de ${from ?? 'ninguém'} para ${to ?? 'ninguém'}`;
  if (kind === 'followup') return `agendou retorno para ${dayLabel(to)}`;
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
          <select className="input" value={existing} onChange={(event) => setExisting(event.target.value)}>
            <option value="">Não, criar novo cadastro</option>
            {duplicates.map((item) => <option key={item.id} value={item.id}>Ligar a {item.name} (mesmo contato)</option>)}
          </select>
        </Field>
      )}
      {!existing && (
        <fieldset className="full checks">
          <legend>Profissional responsável</legend>
          {lists.professionals.filter((item) => item.active).map((item) => (
            <label key={item.id} className="check">
              <input type="checkbox" name="professionals" value={item.id} defaultChecked={item.id === lead.preferred_professional_id} />
              <span>{item.name}</span>
            </label>
          ))}
        </fieldset>
      )}
    </FormModal>
  );
}
