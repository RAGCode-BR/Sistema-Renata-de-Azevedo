import type { Appointment, AppointmentStatus } from '../../../../shared/types.ts';
import { occupiesSlot } from '../../../../shared/types.ts';

// Faixa "Hoje" do Início: quantos pacientes estão agendados e como as sessões do dia se dividem
// (a lista já vem filtrada: clínica toda ou só a profissional). Cada número leva à agenda.
const GROUPS: { key: string; statuses: AppointmentStatus[]; one: string; many: string }[] = [
  { key: 'completed', statuses: ['completed'], one: 'atendida', many: 'atendidas' },
  { key: 'confirmed', statuses: ['confirmed'], one: 'confirmada', many: 'confirmadas' },
  { key: 'pending', statuses: ['scheduled', 'awaiting_confirmation'], one: 'a confirmar', many: 'a confirmar' },
  { key: 'missed', statuses: ['missed'], one: 'falta', many: 'faltas' },
  { key: 'cancelled', statuses: ['cancelled_by_patient', 'cancelled_by_clinic'], one: 'cancelada', many: 'canceladas' }
];

export function TodayPatients({ appointments, loaded, scope }: { appointments: Appointment[]; loaded: boolean; scope: 'clinic' | 'own' }) {
  const patients = new Set(appointments.filter((item) => occupiesSlot(item.status)).map((item) => item.patient_id)).size;
  const groups = GROUPS.map((group) => ({ ...group, count: appointments.filter((item) => group.statuses.includes(item.status)).length }));
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const title = scope === 'clinic' ? 'Hoje na clínica' : 'Seu dia';

  return (
    <section className="today-patients day-band" aria-label={title} aria-busy={!loaded}>
      <a className="day-band-total" href="#/agenda" data-kpi="patients">
        <span className="day-band-title">{title}</span>
        <strong className="kpi-value">{loaded ? patients : '–'}</strong>
        <span>{patients === 1 ? 'paciente agendado' : 'pacientes agendados'}</span>
      </a>
      <div className="day-band-mix">
        <div className="day-bar" aria-hidden="true">
          {loaded && total > 0
            ? groups.filter((group) => group.count).map((group) => <i key={group.key} className={`seg-${group.key}`} style={{ flexGrow: group.count }} />)
            : <i className="seg-empty" />}
        </div>
        <ul className="day-legend">
          {groups.map((group) => (
            <li key={group.key}>
              <a href="#/agenda" className={`day-key key-${group.key}`} data-kpi={group.key}>
                <b className="kpi-value">{loaded ? group.count : '–'}</b> {group.count === 1 ? group.one : group.many}
              </a>
            </li>
          ))}
        </ul>
        {loaded && total === 0 && <p className="day-band-empty">Nenhuma sessão marcada para hoje.</p>}
      </div>
    </section>
  );
}
