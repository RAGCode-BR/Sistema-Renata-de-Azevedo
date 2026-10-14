import { Fragment, useMemo, useState } from 'react';
import type { Appointment, Modality, Patient, Professional, SessionUser } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { addDays, longDay, modalityLabel, plural, startOfToday, statusLabel, time } from '../format.ts';
import { text, useLoad } from '../hooks.ts';

const DAYS = 7;
const DURATIONS = [30, 45, 50, 60, 90];

export function AgendaPage({ user }: { user: SessionUser }) {
  const admin = user.role === 'admin';
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const range = useMemo(() => {
    const from = startOfToday();
    return { from, to: addDays(from, DAYS) };
  }, []);
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([api.appointments(range.from, range.to), api.professionals(), api.patients()]), [range]);
  const [appointments, professionals, patients] = data ?? [[], [], []];
  const canSchedule = professionals.some((item) => item.active) && patients.some((item) => item.status === 'active');

  return (
    <>
      <Heading title="Agenda" lead={`Próximos sete dias · ${plural(appointments.length, 'sessão', 'sessões')}`}>
        {admin && <button type="button" className="button" disabled={loading || !canSchedule} onClick={() => setCreating(true)}>Nova sessão</button>}
      </Heading>

      {admin && data && !canSchedule && (
        <p className="notice">Cadastre uma profissional e um paciente antes de agendar a primeira sessão.</p>
      )}

      <Panel title="Sessões">
        {appointments.length ? <AppointmentTable appointments={appointments} /> :
          <PanelState error={error} loading={!data} empty="Nenhuma sessão neste período." />}
      </Panel>

      {creating && (
        <AppointmentForm professionals={professionals} patients={patients} onClose={() => setCreating(false)}
          onSaved={() => { notify('Sessão agendada.'); reload(); }} />
      )}
    </>
  );
}

function AppointmentTable({ appointments }: { appointments: Appointment[] }) {
  const days = new Map<string, Appointment[]>();
  for (const item of appointments) {
    const day = longDay(item.starts_at);
    days.set(day, [...(days.get(day) ?? []), item]);
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Horário</th><th>Paciente</th><th>Profissional</th><th>Modalidade</th><th>Situação</th></tr>
        </thead>
        <tbody>
          {[...days].map(([day, items]) => (
            <Fragment key={day}>
              <tr className="day-row"><th colSpan={5} scope="colgroup">{day}</th></tr>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="num-left">{time(item.starts_at)}–{time(item.ends_at)}</td>
                  <td>{item.patient_name}</td>
                  <td>{item.professional_name}</td>
                  <td>{modalityLabel[item.modality]}</td>
                  <td><span className={`st st-${item.status}`}>{statusLabel[item.status]}</span></td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface AppointmentFormProps {
  professionals: Professional[];
  patients: Patient[];
  onClose: () => void;
  onSaved: () => void;
}

function AppointmentForm({ professionals, patients, onClose, onSaved }: AppointmentFormProps) {
  const active = professionals.filter((item) => item.active);
  const [professionalId, setProfessionalId] = useState(active[0]?.id ?? '');
  // Só aparecem pacientes vinculados à profissional escolhida, como o servidor exige.
  const options = patients.filter((item) => item.status === 'active' && item.professional_ids.includes(professionalId));

  return (
    <FormModal title="Nova sessão" submitLabel="Agendar" onClose={onClose} onSubmit={async (data) => {
      const start = new Date(text(data, 'startsAt'));
      if (Number.isNaN(start.getTime())) throw new Error('Informe o início da sessão.');
      const end = new Date(start.getTime() + Number(text(data, 'duration')) * 60_000);
      await api.createAppointment({
        professionalId,
        patientId: text(data, 'patientId'),
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        modality: text(data, 'modality') as Modality
      });
      onSaved();
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
        <input className="input" name="startsAt" type="datetime-local" required />
      </Field>
      <Field label="Duração">
        <select className="input" name="duration" defaultValue="50">
          {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}
        </select>
      </Field>
      <Field label="Modalidade" full>
        <select className="input" name="modality" defaultValue="presencial">
          {Object.entries(modalityLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </Field>
    </FormModal>
  );
}
