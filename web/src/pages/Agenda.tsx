import { useEffect, useMemo, useState } from 'react';
import { can } from '../../../shared/permissions.ts';
import { occupiesSlot } from '../../../shared/types.ts';
import type { Appointment, ScheduleBlock, SessionUser } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Heading, PanelState } from '../components/Page.tsx';
import { ScheduleGrid, statusClass } from '../components/ScheduleGrid.tsx';
import type { GridColumn } from '../components/ScheduleGrid.tsx';
import { useToast } from '../components/Toast.tsx';
import {
  addDays, dateKey, parseDateKey, plural, sameDay, startOfMonth, startOfToday, startOfWeek, time
} from '../format.ts';
import { useLoad } from '../hooks.ts';
import { AppointmentDetails, AppointmentForm, BlockDetails, BlockForm } from './agenda/dialogs.tsx';

type View = 'day' | 'week' | 'month';

const VIEW_LABEL: Record<View, string> = { day: 'Dia', week: 'Semana', month: 'Mês' };
const VIEW_KEY = 'rda-agenda-visao';

function readView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    return saved === 'day' || saved === 'week' || saved === 'month' ? saved : 'week';
  } catch { return 'week'; }
}

function rangeOf(view: View, anchor: Date): { from: Date; to: Date } {
  if (view === 'day') return { from: anchor, to: addDays(anchor, 1) };
  if (view === 'week') { const from = startOfWeek(anchor); return { from, to: addDays(from, 7) }; }
  const from = startOfWeek(startOfMonth(anchor));
  return { from, to: addDays(from, 42) };
}

function titleOf(view: View, anchor: Date): string {
  if (view === 'day') return anchor.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'week') {
    const from = startOfWeek(anchor);
    const to = addDays(from, 6);
    const month = (date: Date) => date.toLocaleDateString('pt-BR', { month: 'long' });
    return from.getMonth() === to.getMonth()
      ? `${from.getDate()} a ${to.getDate()} de ${month(to)} de ${to.getFullYear()}`
      : `${from.getDate()} de ${month(from)} a ${to.getDate()} de ${month(to)} de ${to.getFullYear()}`;
  }
  return anchor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function step(view: View, anchor: Date, direction: number): Date {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

type Dialog =
  | { kind: 'new'; professionalId?: string; start?: Date }
  | { kind: 'block'; professionalId?: string; start?: Date }
  | { kind: 'appointment'; appointment: Appointment }
  | { kind: 'blockDetails'; block: ScheduleBlock }
  | null;

// `date` e `session` vêm do endereço (#/agenda?data=…&sessao=…), usado pelos atalhos do Início.
export function AgendaPage({ user, date, session }: { user: SessionUser; date: string | null; session: string | null }) {
  const notify = useToast();
  const manager = can(user, 'appointments.manage');
  const overview = can(user, 'appointments.view_all');
  const ownProfessional = user.roles.includes('professional') ? user.professional_id : null;

  const [view, setView] = useState<View>(() => (date ? 'day' : readView()));
  const [anchor, setAnchor] = useState(() => parseDateKey(date) ?? startOfToday());
  const [professionalFilter, setProfessionalFilter] = useState('');
  const [specialtyFilter, setSpecialtyFilter] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);

  const range = useMemo(() => rangeOf(view, anchor), [view, anchor]);
  const { data, error, loading, reload } = useLoad(() => Promise.all([
    api.appointments(range.from, range.to),
    api.professionals(),
    manager ? api.patients() : Promise.resolve([]),
    api.scheduleBlocks(range.from, range.to)
  ]), [range, manager]);
  const [appointments, professionals, patients, blocks] = data ?? [[], [], [], []];

  // Abre a sessão pedida pelo endereço assim que os dados chegam.
  useEffect(() => {
    if (!session || !data) return;
    const target = appointments.find((item) => item.id === session);
    if (target) setDialog({ kind: 'appointment', appointment: target });
  }, [session, data]);

  function changeView(next: View) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* preferência só desta visita */ }
  }

  const specialties = [...new Set(professionals.map((item) => item.specialty).filter((item): item is string => Boolean(item)))].sort();
  // Quem não vê a agenda geral enxerga só a própria coluna.
  const visibleProfessionals = professionals.filter((item) => item.active
    && (overview || item.id === ownProfessional)
    && (!professionalFilter || item.id === professionalFilter)
    && (!specialtyFilter || item.specialty === specialtyFilter));
  const visibleIds = new Set(visibleProfessionals.map((item) => item.id));
  const shownAppointments = appointments.filter((item) => visibleIds.has(item.professional_id) && (showCancelled || occupiesSlot(item.status)));
  const shownBlocks = blocks.filter((item) => visibleIds.has(item.professional_id));
  const active = shownAppointments.filter((item) => occupiesSlot(item.status));
  const awaiting = active.filter((item) => item.status === 'scheduled' || item.status === 'awaiting_confirmation').length;
  const canBlock = manager || Boolean(ownProfessional);
  const blockable = manager ? professionals : professionals.filter((item) => item.id === ownProfessional);

  const onDay = <T extends { starts_at: string }>(items: T[], day: Date) => items.filter((item) => sameDay(new Date(item.starts_at), day));
  const columns: GridColumn[] = view === 'day'
    ? visibleProfessionals.map((professional) => {
      const mine = onDay(shownAppointments, anchor).filter((item) => item.professional_id === professional.id);
      return {
        key: professional.id, title: professional.name,
        subtitle: [professional.specialty, plural(mine.filter((item) => occupiesSlot(item.status)).length, 'sessão', 'sessões')].filter(Boolean).join(' · '),
        date: anchor, professionalId: professional.id, appointments: mine,
        blocks: onDay(shownBlocks, anchor).filter((item) => item.professional_id === professional.id)
      };
    })
    : Array.from({ length: 7 }, (_, index) => {
      const day = addDays(range.from, index);
      const dayAppointments = onDay(shownAppointments, day);
      return {
        key: dateKey(day),
        title: day.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
        subtitle: plural(dayAppointments.filter((item) => occupiesSlot(item.status)).length, 'sessão', 'sessões'),
        date: day,
        professionalId: visibleProfessionals.length === 1 ? visibleProfessionals[0]!.id : null,
        appointments: dayAppointments,
        blocks: onDay(shownBlocks, day)
      };
    });

  const onFreeSlot = manager
    ? (column: GridColumn, start: Date) => setDialog({ kind: 'new', professionalId: column.professionalId ?? undefined, start })
    : ownProfessional ? (_column: GridColumn, start: Date) => setDialog({ kind: 'block', professionalId: ownProfessional, start }) : undefined;

  const closed = (message?: string) => {
    if (message) notify(message);
    setDialog(null);
    reload();
  };

  return (
    <>
      <Heading title="Agenda" lead={data ? `${plural(active.length, 'sessão marcada', 'sessões marcadas')} no período${awaiting ? `, ${awaiting} a confirmar` : ''}.` : 'Carregando…'}>
        {canBlock && <button type="button" className="button light" disabled={loading} onClick={() => setDialog({ kind: 'block', professionalId: ownProfessional ?? undefined })}>Bloquear horário</button>}
        {manager && <button type="button" className="button" disabled={loading} onClick={() => setDialog({ kind: 'new', professionalId: professionalFilter || undefined })}>Nova sessão</button>}
      </Heading>

      <section className="agenda-toolbar" aria-label="Período e filtros">
        <div className="tabs" role="tablist" aria-label="Visão">
          {(Object.keys(VIEW_LABEL) as View[]).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={view === item} className={view === item ? 'tab on' : 'tab'}
              onClick={() => changeView(item)}>{VIEW_LABEL[item]}</button>
          ))}
        </div>
        <div className="pager">
          <button type="button" className="link-btn" aria-label="Período anterior" onClick={() => setAnchor(step(view, anchor, -1))}>‹</button>
          <button type="button" className="link-btn" onClick={() => setAnchor(startOfToday())}>Hoje</button>
          <button type="button" className="link-btn" aria-label="Próximo período" onClick={() => setAnchor(step(view, anchor, 1))}>›</button>
        </div>
        <h2 className="agenda-period">{titleOf(view, anchor)}</h2>
        <div className="tools">
          {overview && (
            <select className="input compact" aria-label="Profissional" value={professionalFilter} onChange={(event) => setProfessionalFilter(event.target.value)}>
              <option value="">Todas as profissionais</option>
              {professionals.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          {overview && specialties.length > 0 && (
            <select className="input compact" aria-label="Especialidade" value={specialtyFilter} onChange={(event) => setSpecialtyFilter(event.target.value)}>
              <option value="">Todas as especialidades</option>
              {specialties.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          )}
          <label className="check small"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} />Mostrar canceladas e remarcadas</label>
        </div>
      </section>

      {error && <p className="notice erro" role="alert">{error}</p>}
      {manager && data && (!patients.length || !professionals.some((item) => item.active)) && (
        <p className="notice">Cadastre uma profissional e um paciente antes de agendar a primeira sessão.</p>
      )}

      {!data ? <PanelState error={error} loading={!data} empty="" /> : view === 'month' ? (
        <MonthView from={range.from} anchor={anchor} appointments={shownAppointments} blocks={shownBlocks}
          onPickDay={(day) => { setAnchor(day); changeView('day'); }} />
      ) : columns.length ? (
        <ScheduleGrid columns={columns} week={view === 'week'} showProfessional={view === 'week' && visibleProfessionals.length > 1}
          onOpenAppointment={(appointment) => setDialog({ kind: 'appointment', appointment })}
          onOpenBlock={(block) => setDialog({ kind: 'blockDetails', block })} onFreeSlot={onFreeSlot} />
      ) : <p className="notice">Nenhuma profissional com esses filtros.</p>}

      {dialog?.kind === 'new' && (
        <AppointmentForm professionals={professionals} patients={patients} initial={dialog} onClose={() => setDialog(null)} onSaved={closed} />
      )}
      {dialog?.kind === 'block' && (
        <BlockForm professionals={blockable} initial={dialog} onClose={() => setDialog(null)} onSaved={closed} />
      )}
      {dialog?.kind === 'appointment' && (
        <AppointmentDetails appointment={dialog.appointment} ownProfessional={ownProfessional}
          canManage={manager || dialog.appointment.professional_id === ownProfessional}
          onClose={() => setDialog(null)} onChanged={() => closed()} />
      )}
      {dialog?.kind === 'blockDetails' && (
        <BlockDetails block={dialog.block} onClose={() => setDialog(null)} onChanged={() => closed()} />
      )}
    </>
  );
}

const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const SHOWN = 3;

interface MonthViewProps {
  from: Date;
  anchor: Date;
  appointments: Appointment[];
  blocks: ScheduleBlock[];
  onPickDay: (day: Date) => void;
}

// Mês: cada dia mostra até 3 sessões; clicar no dia abre a visão do dia.
function MonthView({ from, anchor, appointments, blocks, onPickDay }: MonthViewProps) {
  const today = startOfToday();
  return (
    <section className="month" aria-label="Mês">
      {WEEKDAYS.map((day) => <div key={day} className="month-head">{day}</div>)}
      {Array.from({ length: 42 }, (_, index) => {
        const day = addDays(from, index);
        const items = appointments.filter((item) => sameDay(new Date(item.starts_at), day));
        const blocked = blocks.some((item) => sameDay(new Date(item.starts_at), day));
        const classes = ['month-day', day.getMonth() !== anchor.getMonth() && 'outside', sameDay(day, today) && 'today'].filter(Boolean).join(' ');
        return (
          <button key={index} type="button" className={classes} onClick={() => onPickDay(day)}
            aria-label={`${day.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}: ${plural(items.length, 'sessão', 'sessões')}`}>
            <b>{day.getDate()}</b>
            {items.slice(0, SHOWN).map((item) => (
              <span key={item.id} className={`month-item ${statusClass(item)}`}>{time(item.starts_at)} {item.patient_name}</span>
            ))}
            {items.length > SHOWN && <span className="month-more">+{items.length - SHOWN}</span>}
            {blocked && <span className="month-item b-bloqueio">bloqueio</span>}
          </button>
        );
      })}
    </section>
  );
}
