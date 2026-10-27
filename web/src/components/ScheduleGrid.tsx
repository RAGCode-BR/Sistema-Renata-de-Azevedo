import type { CSSProperties } from 'react';
import type { Appointment, AppointmentStatus, ScheduleBlock } from '../../../shared/types.ts';
import { minutesBetween, sameDay, statusLabel, time } from '../format.ts';

// Grade de horários (visões Dia e Semana), com o visual da demonstração (assets/css/app.css).
// Cada coluna é um dia ou uma profissional; sessões e bloqueios são posicionados pela hora exata
// de início e pela duração. Itens sobrepostos na mesma coluna ficam lado a lado.

export interface GridColumn {
  key: string;
  title: string;
  subtitle?: string;
  professionalColor?: string;
  date: Date;
  professionalId: string | null;
  appointments: Appointment[];
  blocks: ScheduleBlock[];
}

interface ScheduleGridProps {
  columns: GridColumn[];
  week: boolean;
  showProfessional: boolean;
  onOpenAppointment: (appointment: Appointment) => void;
  onOpenBlock: (block: ScheduleBlock) => void;
  // Ausente quando quem vê não pode criar nada a partir da grade.
  onFreeSlot?: (column: GridColumn, start: Date) => void;
}

const FIRST_HOUR = 7;
const LAST_HOUR = 21;

// Classe de cor por situação (estilos .b-* da demonstração e de styles.css).
export function statusClass(item: Appointment): string {
  const ended = new Date(item.ends_at).getTime() < Date.now();
  const unrecorded: AppointmentStatus[] = ['scheduled', 'awaiting_confirmation', 'confirmed'];
  if (ended && unrecorded.includes(item.status)) return 'b-aregistrar';
  return {
    scheduled: 'b-agendada',
    awaiting_confirmation: 'b-aguardando',
    confirmed: 'b-confirmada',
    completed: 'b-realizada',
    missed: 'b-falta',
    cancelled_by_patient: 'b-cancelada',
    cancelled_by_clinic: 'b-cancelada',
    rescheduled: 'b-cancelada'
  }[item.status];
}

interface Placed<T> { item: T; start: Date; end: Date; lane: number; lanes: number }

// Distribui itens sobrepostos em faixas lado a lado.
function placeInLanes<T extends { starts_at: string; ends_at: string }>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const placed: Placed<T>[] = [];
  let group: Placed<T>[] = [];
  let groupEnd = 0;
  const closeGroup = () => {
    const lanes = Math.max(1, ...group.map((entry) => entry.lane + 1));
    group.forEach((entry) => { entry.lanes = lanes; });
    group = [];
  };
  for (const item of sorted) {
    const start = new Date(item.starts_at);
    const end = new Date(item.ends_at);
    if (group.length && start.getTime() >= groupEnd) closeGroup();
    const busy = new Set(group.filter((entry) => entry.end > start).map((entry) => entry.lane));
    let lane = 0;
    while (busy.has(lane)) lane += 1;
    const entry = { item, start, end, lane, lanes: 1 };
    group.push(entry);
    placed.push(entry);
    groupEnd = Math.max(groupEnd, end.getTime());
  }
  closeGroup();
  return placed;
}

function position(start: Date, minutes: number, lane: number, lanes: number): CSSProperties {
  return {
    '--start': start.getMinutes(),
    '--dur': Math.max(minutes, 20),
    '--lane': lane,
    '--lanes': lanes
  } as CSSProperties;
}

export function ScheduleGrid({ columns, week, showProfessional, onOpenAppointment, onOpenBlock, onFreeSlot }: ScheduleGridProps) {
  const items = columns.flatMap((column) => [...column.appointments, ...column.blocks]);
  const firstHour = Math.min(FIRST_HOUR, ...items.map((item) => new Date(item.starts_at).getHours()));
  const lastHour = Math.max(LAST_HOUR, ...items.map((item) => {
    const end = new Date(item.ends_at);
    return end.getHours() - (end.getMinutes() === 0 ? 1 : 0);
  }));
  const hours = Array.from({ length: lastHour - firstHour + 1 }, (_, index) => firstHour + index);
  const now = new Date();

  const placed = columns.map((column) => ({
    appointments: placeInLanes(column.appointments),
    blocks: placeInLanes(column.blocks)
  }));

  return (
    <div className={week ? 'agenda week' : 'agenda'}>
      <div className="grid-wrap">
        <div className="grid schedule-grid" style={{ '--colunas': columns.length } as CSSProperties} role="grid">
          <div className="col-head" />
          {columns.map((column) => (
            <div key={column.key} className={sameDay(column.date, now) && week ? 'col-head today' : 'col-head'} role="columnheader">
              <strong className="schedule-column-title">{column.professionalColor &&
                <span className="professional-color-dot" style={{ background: column.professionalColor }} aria-hidden="true" />}{column.title}</strong>{column.subtitle}
            </div>
          ))}

          {hours.map((hour) => (
            <Row key={hour} hour={hour} columns={columns} placed={placed} now={now} showProfessional={showProfessional}
              onOpenAppointment={onOpenAppointment} onOpenBlock={onOpenBlock} onFreeSlot={onFreeSlot} />
          ))}
        </div>
      </div>
      <div className="agenda-footer" aria-label="Legenda">
        <span className="key"><i className="b-agendada" />agendada</span>
        <span className="key"><i className="b-aguardando" />aguardando confirmação</span>
        <span className="key"><i className="b-confirmada" />confirmada</span>
        <span className="key"><i className="b-aregistrar" />registrar presença</span>
        <span className="key"><i className="b-realizada" />realizada</span>
        <span className="key"><i className="b-falta" />faltou</span>
        <span className="key"><i className="b-bloqueio" />horário bloqueado</span>
      </div>
    </div>
  );
}

interface RowProps extends Omit<ScheduleGridProps, 'week'> {
  hour: number;
  placed: { appointments: Placed<Appointment>[]; blocks: Placed<ScheduleBlock>[] }[];
  now: Date;
}

function Row({ hour, columns, placed, now, showProfessional, onOpenAppointment, onOpenBlock, onFreeSlot }: RowProps) {
  return (
    <>
      <div className="hour">{hour}h</div>
      {columns.map((column, index) => {
        const inHour = <T,>(entry: Placed<T>) => entry.start.getHours() === hour;
        const appointments = placed[index]!.appointments.filter(inHour);
        const blocks = placed[index]!.blocks.filter(inHour);
        const slotStart = new Date(column.date.getFullYear(), column.date.getMonth(), column.date.getDate(), hour);
        const nowHere = sameDay(column.date, now) && now.getHours() === hour;
        return (
          <div key={column.key} className="cell" role="gridcell">
            {nowHere && (
              <div className={index === 0 ? 'now-mark first' : 'now-mark'} style={{ top: `${(now.getMinutes() / 60) * 100}%` }} />
            )}
            {onFreeSlot && (
              <button type="button" className="free" onClick={() => onFreeSlot(column, slotStart)}>
                {hour}h
              </button>
            )}
            {blocks.map(({ item, start, lane, lanes }) => (
              <button key={item.id} type="button" className="session slot-item b-bloqueio"
                style={position(start, minutesBetween(item.starts_at, item.ends_at), lane, lanes)}
                title={`Bloqueado das ${time(item.starts_at)} às ${time(item.ends_at)}`} onClick={() => onOpenBlock(item)}>
                <strong>{item.reason ?? 'Horário bloqueado'}</strong>
                <span>{time(item.starts_at)}–{time(item.ends_at)}{showProfessional ? `, ${item.professional_name}` : ''}</span>
              </button>
            ))}
            {appointments.map(({ item, start, lane, lanes }) => (
              <button key={item.id} type="button" className={`session slot-item ${statusClass(item)}`}
                style={position(start, minutesBetween(item.starts_at, item.ends_at), lane, lanes)}
                title={`${item.patient_name}, ${time(item.starts_at)}, ${statusLabel[item.status]}`}
                onClick={() => onOpenAppointment(item)}>
                <strong>{item.patient_name}</strong>
                <span>{time(item.starts_at)}{showProfessional ? `, ${item.professional_name}` : ''}, {statusLabel[item.status].toLowerCase()}</span>
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
