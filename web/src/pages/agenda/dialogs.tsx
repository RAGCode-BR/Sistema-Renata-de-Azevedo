import { useState } from 'react';
import type {
  Appointment, AppointmentStatus, Frequency, Modality, Patient, Professional, ScheduleBlock, SessionType
} from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal, Modal } from '../../components/Modal.tsx';
import { useToast } from '../../components/Toast.tsx';
import {
  dateTime, frequencyLabel, longDay, minutesBetween, modalityLabel, plural, sessionTypeLabel, statusLabel, time, toLocalInput
} from '../../format.ts';
import { errorMessage, text, useLoad } from '../../hooks.ts';

const DURATIONS = [30, 45, 50, 60, 90, 120];

// Nova sessão -----------------------------------------------------------------------------------

interface AppointmentFormProps {
  professionals: Professional[];
  patients: Patient[];
  initial: { professionalId?: string; start?: Date };
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function AppointmentForm({ professionals, patients, initial, onClose, onSaved }: AppointmentFormProps) {
  const active = professionals.filter((item) => item.active);
  const [professionalId, setProfessionalId] = useState(initial.professionalId ?? active[0]?.id ?? '');
  const [frequency, setFrequency] = useState<Frequency | ''>('');
  // Só aparecem pacientes vinculados à profissional escolhida, como o banco exige.
  const options = patients.filter((item) => item.status === 'active' && item.professional_ids.includes(professionalId));

  return (
    <FormModal title="Nova sessão" submitLabel={frequency ? 'Agendar série' : 'Agendar'} onClose={onClose} onSubmit={async (data) => {
      const start = new Date(text(data, 'startsAt'));
      if (Number.isNaN(start.getTime())) throw new Error('Informe o início da sessão.');
      const end = new Date(start.getTime() + Number(text(data, 'duration')) * 60_000);
      const count = Number(text(data, 'count'));
      await api.createAppointment({
        professionalId,
        patientId: text(data, 'patientId'),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        modality: text(data, 'modality') as Modality,
        sessionType: text(data, 'sessionType') as SessionType,
        recurrence: frequency ? { frequency, count } : null
      });
      onSaved(frequency ? `${plural(count, 'sessão agendada', 'sessões agendadas')}.` : 'Sessão agendada.');
    }}>
      <Field label="Profissional">
        <select className="input" name="professionalId" value={professionalId} onChange={(event) => setProfessionalId(event.target.value)}>
          {active.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="Paciente">
        <select className="input" name="patientId" key={professionalId} required>
          {options.length ? options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) :
            <option value="">Nenhum paciente vinculado</option>}
        </select>
      </Field>
      <Field label="Início">
        <input className="input" name="startsAt" type="datetime-local" required
          defaultValue={initial.start ? toLocalInput(initial.start) : undefined} />
      </Field>
      <Field label="Duração">
        <select className="input" name="duration" defaultValue="50">
          {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}
        </select>
      </Field>
      <Field label="Tipo de atendimento">
        <select className="input" name="sessionType" defaultValue="individual">
          {Object.entries(sessionTypeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Modalidade">
        <select className="input" name="modality" defaultValue="presencial">
          {Object.entries(modalityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      <Field label="Repetir">
        <select className="input" name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency | '')}>
          <option value="">Não repete</option>
          {Object.entries(frequencyLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
      {frequency && (
        <Field label="Quantidade de sessões">
          <input className="input" name="count" type="number" min={2} max={52} defaultValue={12} required />
        </Field>
      )}
      {frequency && (
        <p className="muted small full">
          Se alguma data tiver conflito com outra sessão ou com um bloqueio, nenhuma sessão da série é criada.
        </p>
      )}
    </FormModal>
  );
}

// Detalhes e ações de uma sessão -----------------------------------------------------------------

interface AppointmentDetailsProps {
  appointment: Appointment;
  canManage: boolean;
  ownProfessional: string | null;
  onClose: () => void;
  onChanged: (message: string) => void;
}

type Mode = 'view' | 'cancel' | 'reschedule';

const ACTIVE: AppointmentStatus[] = ['scheduled', 'awaiting_confirmation', 'confirmed'];

export function AppointmentDetails({ appointment, canManage, ownProfessional, onClose, onChanged }: AppointmentDetailsProps) {
  const notify = useToast();
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { data: events } = useLoad(() => api.appointmentEvents(appointment.id), [appointment.id]);
  const started = new Date(appointment.starts_at).getTime() <= Date.now();
  const active = ACTIVE.includes(appointment.status);
  const mine = appointment.professional_id === ownProfessional;

  async function act(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    try {
      await action();
      notify(message);
      onChanged(message);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }
  const setStatus = (status: AppointmentStatus, message: string) =>
    act(() => api.setAppointmentStatus(appointment.id, status), message);

  if (mode === 'cancel') {
    return (
      <FormModal title="Cancelar sessão" submitLabel="Cancelar sessão" onClose={onClose} onSubmit={async (data) => {
        const cancelled = await api.cancelAppointment(appointment.id, text(data, 'by') as 'patient' | 'clinic',
          text(data, 'reason'), data.get('following') === 'on');
        const message = cancelled > 1 ? `${plural(cancelled, 'sessão cancelada', 'sessões canceladas')}.` : 'Sessão cancelada.';
        notify(message);
        onChanged(message);
      }}>
        <p className="modal-text full">{appointment.patient_name}, {longDay(appointment.starts_at)} às {time(appointment.starts_at)}.</p>
        <fieldset className="full checks">
          <legend>Quem cancelou</legend>
          <label className="check"><input type="radio" name="by" value="patient" defaultChecked />Paciente</label>
          <label className="check"><input type="radio" name="by" value="clinic" />Clínica</label>
        </fieldset>
        <Field label="Motivo (opcional)" full><input className="input" name="reason" maxLength={500} /></Field>
        {appointment.series_id && (
          <label className="check full"><input type="checkbox" name="following" />Cancelar também as próximas sessões desta série</label>
        )}
      </FormModal>
    );
  }

  if (mode === 'reschedule') {
    const duration = minutesBetween(appointment.starts_at, appointment.ends_at);
    return (
      <FormModal title="Remarcar sessão" submitLabel="Remarcar" onClose={onClose} onSubmit={async (data) => {
        const start = new Date(text(data, 'startsAt'));
        if (Number.isNaN(start.getTime())) throw new Error('Informe o novo horário.');
        const end = new Date(start.getTime() + Number(text(data, 'duration')) * 60_000);
        await api.rescheduleAppointment(appointment.id, start.toISOString(), end.toISOString());
        notify('Sessão remarcada.');
        onChanged('Sessão remarcada.');
      }}>
        <p className="modal-text full">
          {appointment.patient_name}, hoje marcada para {longDay(appointment.starts_at)} às {time(appointment.starts_at)}.
          A sessão atual fica como &ldquo;remarcada&rdquo; e uma nova é criada no horário escolhido.
        </p>
        <Field label="Novo início">
          <input className="input" name="startsAt" type="datetime-local" required defaultValue={toLocalInput(new Date(appointment.starts_at))} />
        </Field>
        <Field label="Duração">
          <select className="input" name="duration" defaultValue={String(DURATIONS.includes(duration) ? duration : 50)}>
            {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}
          </select>
        </Field>
      </FormModal>
    );
  }

  return (
    <Modal title={appointment.patient_name} onClose={onClose}>
      <div className="modal-body">
        <dl className="facts">
          <dt>Quando</dt><dd>{longDay(appointment.starts_at)}, {time(appointment.starts_at)}–{time(appointment.ends_at)}</dd>
          <dt>Profissional</dt><dd>{appointment.professional_name}</dd>
          <dt>Atendimento</dt><dd>{sessionTypeLabel[appointment.session_type]}, {modalityLabel[appointment.modality].toLowerCase()}</dd>
          <dt>Situação</dt>
          <dd>
            <span className={`st st-${appointment.status}`}>{statusLabel[appointment.status]}</span>
            {appointment.cancellation_reason && <span className="sub">Motivo: {appointment.cancellation_reason}</span>}
          </dd>
          {appointment.series_id && <><dt>Série</dt><dd>Sessão recorrente</dd></>}
          {appointment.rescheduled_from && <><dt>Origem</dt><dd>Remarcada de outro horário</dd></>}
        </dl>

        {canManage && active && (
          <div className="status-actions" role="group" aria-label="Ações da sessão">
            {started ? (
              <>
                <button type="button" className="button" disabled={busy} onClick={() => setStatus('completed', 'Presença registrada.')}>Realizada</button>
                <button type="button" className="button light" disabled={busy} onClick={() => setStatus('missed', 'Falta registrada.')}>Paciente faltou</button>
              </>
            ) : (
              <>
                {appointment.status !== 'confirmed' && (
                  <button type="button" className="button" disabled={busy} onClick={() => setStatus('confirmed', 'Sessão confirmada.')}>Confirmar</button>
                )}
                {appointment.status === 'scheduled' && (
                  <button type="button" className="button light" disabled={busy}
                    onClick={() => setStatus('awaiting_confirmation', 'Aguardando confirmação.')}>Aguardando confirmação</button>
                )}
                <button type="button" className="button light" disabled={busy} onClick={() => setMode('reschedule')}>Remarcar</button>
              </>
            )}
            <button type="button" className="link-btn danger" disabled={busy} onClick={() => setMode('cancel')}>Cancelar sessão</button>
          </div>
        )}

        {canManage && !active && appointment.status !== 'rescheduled' && (
          <div className="status-actions" role="group" aria-label="Corrigir situação">
            <label className="field">
              <span>Corrigir situação</span>
              <select className="input" disabled={busy} value="" onChange={(event) => {
                const status = event.target.value as AppointmentStatus;
                if (status) void setStatus(status, 'Situação corrigida.');
              }}>
                <option value="" disabled>Escolha a situação correta</option>
                {(['confirmed', 'completed', 'missed', 'cancelled_by_patient', 'cancelled_by_clinic'] as AppointmentStatus[])
                  .filter((status) => status !== appointment.status && (started || !['completed', 'missed'].includes(status)))
                  .map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}
              </select>
            </label>
          </div>
        )}

        {mine && (
          <p className="small">
            <a className="link-btn" href={`#/prontuarios?paciente=${appointment.patient_id}${appointment.status === 'completed' ? `&sessao=${appointment.id}` : ''}`}>
              Abrir prontuário
            </a>
          </p>
        )}

        {error && <p className="erro" role="alert">{error}</p>}

        <h3 className="history-title">Histórico</h3>
        {events ? (
          <ol className="history">
            {events.map((event) => (
              <li key={event.id}>
                <span className="muted small">{dateTime(event.created_at)}</span>
                {event.action === 'created' && <>Criada como {statusLabel[event.to_status ?? 'scheduled'].toLowerCase()}</>}
                {event.action === 'status_changed' && (
                  <>{statusLabel[event.from_status ?? 'scheduled']} → {statusLabel[event.to_status ?? 'scheduled']}
                    {event.reason && <span className="sub">Motivo: {event.reason}</span>}</>
                )}
                {event.action === 'updated' && <>Dados da sessão alterados</>}
              </li>
            ))}
          </ol>
        ) : <p className="muted small">Carregando…</p>}
      </div>
    </Modal>
  );
}

// Bloqueios ------------------------------------------------------------------------------------

interface BlockFormProps {
  professionals: Professional[];
  initial: { professionalId?: string; start?: Date };
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function BlockForm({ professionals, initial, onClose, onSaved }: BlockFormProps) {
  const active = professionals.filter((item) => item.active);
  const start = initial.start ?? null;
  const end = start ? new Date(start.getTime() + 60 * 60_000) : null;

  return (
    <FormModal title="Bloquear horário" submitLabel="Bloquear" onClose={onClose} onSubmit={async (data) => {
      const from = new Date(text(data, 'startsAt'));
      const to = new Date(text(data, 'endsAt'));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw new Error('Informe início e fim do bloqueio.');
      await api.createScheduleBlock({
        professionalId: text(data, 'professionalId'),
        startsAt: from.toISOString(),
        endsAt: to.toISOString(),
        reason: text(data, 'reason'),
        reasonPrivate: data.get('reasonPrivate') === 'on'
      });
      onSaved('Horário bloqueado.');
    }}>
      <Field label="Profissional" full>
        <select className="input" name="professionalId" defaultValue={initial.professionalId ?? active[0]?.id}>
          {active.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </Field>
      <Field label="Início"><input className="input" name="startsAt" type="datetime-local" required defaultValue={start ? toLocalInput(start) : undefined} /></Field>
      <Field label="Fim"><input className="input" name="endsAt" type="datetime-local" required defaultValue={end ? toLocalInput(end) : undefined} /></Field>
      <Field label="Motivo (opcional)" full><input className="input" name="reason" maxLength={200} /></Field>
      <label className="check full">
        <input type="checkbox" name="reasonPrivate" />
        <span>Motivo privado<span className="sub">Só a profissional e quem bloqueou veem o motivo; os demais veem &ldquo;Horário bloqueado&rdquo;.</span></span>
      </label>
    </FormModal>
  );
}

export function BlockDetails({ block, onClose, onChanged }: { block: ScheduleBlock; onClose: () => void; onChanged: (message: string) => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal title="Horário bloqueado" onClose={onClose}>
      <div className="modal-body">
        <dl className="facts">
          <dt>Profissional</dt><dd>{block.professional_name}</dd>
          <dt>Quando</dt><dd>{longDay(block.starts_at)}, {time(block.starts_at)}–{time(block.ends_at)}</dd>
          <dt>Motivo</dt>
          <dd>{block.reason ?? (block.reason_private ? 'Privado' : '—')}{block.reason_private && block.reason && <span className="sub">Motivo privado</span>}</dd>
        </dl>
        {error && <p className="erro" role="alert">{error}</p>}
      </div>
      {block.can_manage && (
        <div className="modal-foot">
          <button type="button" className="button danger" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              await api.deleteScheduleBlock(block.id);
              notify('Bloqueio removido.');
              onChanged('Bloqueio removido.');
            } catch (failure) {
              setError(errorMessage(failure));
              setBusy(false);
            }
          }}>Remover bloqueio</button>
        </div>
      )}
    </Modal>
  );
}
