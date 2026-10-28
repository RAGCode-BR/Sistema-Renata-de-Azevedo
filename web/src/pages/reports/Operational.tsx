import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { NoteStatusRow, Professional, SessionReportRow, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Heading, PanelState } from '../../components/Page.tsx';
import { modalityLabel, patientStatusLabel, sessionTypeLabel } from '../../format.ts';
import { useLoad } from '../../hooks.ts';
import { ProfessionalFilter, PrintButton, ReportTable, Stat, formatValue, ratio, usePeriod } from './shared.tsx';
import type { Column } from './shared.tsx';

type Group = 'professional' | 'type' | 'modality';
type Totals = Omit<SessionReportRow, 'professional_id' | 'professional_name' | 'session_type' | 'modality'> & { key: string };

const KEYS = ['total', 'completed', 'missed', 'cancelled_by_patient', 'late_cancel', 'cancelled_by_clinic', 'rescheduled', 'unrecorded', 'upcoming', 'completed_minutes'] as const;

function aggregate(rows: SessionReportRow[], key: (row: SessionReportRow) => string): Totals[] {
  const map = new Map<string, Totals>();
  for (const row of rows) {
    const name = key(row);
    const item = map.get(name) ?? { key: name, ...Object.fromEntries(KEYS.map((k) => [k, 0])) } as Totals;
    for (const k of KEYS) item[k] += Number(row[k]);
    map.set(name, item);
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const missRate = (row: Pick<Totals, 'missed' | 'completed'>) => ratio(row.missed, row.completed + row.missed);
const sum = (rows: Totals[], key: (typeof KEYS)[number]) => rows.reduce((total, row) => total + row[key], 0);

// Operacional: sessões, pacientes, prontuários e tarefas. Quem vê a agenda geral escolhe a profissional;
// a profissional vê só os próprios números ("Meus números").
export function OperationalReportPage({ user }: { user: SessionUser }) {
  const all = can(user, 'appointments.view_all');
  const { period, fields } = usePeriod();
  const [professional, setProfessional] = useState('');
  const [group, setGroup] = useState<Group>('professional');
  const scope = all ? professional || null : user.professional_id;
  const { data, error } = useLoad(() => Promise.all([
    api.reportSessions(period.from, period.to, scope),
    api.reportPatients(period.from, period.to, scope),
    api.noteStatus(new Date(`${period.from}T00:00:00`), new Date(`${period.to}T23:59:59`)),
    all ? api.professionals() : Promise.resolve([] as Professional[])
  ]), [period.from, period.to, scope]);

  const title = all ? 'Relatório operacional' : 'Meus números';
  const filters = <div className="report-filters no-print">{fields}{all && data && <ProfessionalFilter professionals={data[3]} value={professional} onChange={setProfessional} />}</div>;
  if (!data) return <><Heading title={title} lead={period.label}><PrintButton /></Heading>{filters}<PanelState error={error} loading={!error} empty="" /></>;

  const [sessions, patients, notes] = data;
  const keyOf = (row: SessionReportRow) => group === 'type' ? sessionTypeLabel[row.session_type] : group === 'modality' ? modalityLabel[row.modality] : row.professional_name;
  const grouped = aggregate(sessions, keyOf);
  const totals = aggregate(sessions, () => 'Total')[0];
  const cancelled = totals ? totals.cancelled_by_patient + totals.cancelled_by_clinic : 0;
  const scopedNotes = notes.filter((row: NoteStatusRow) => !scope || row.professional_id === scope);

  const sessionColumns: Column<Totals>[] = [
    { label: group === 'professional' ? 'Profissional' : group === 'type' ? 'Tipo' : 'Modalidade', value: (row) => row.key },
    { label: 'Marcadas', value: (row) => row.total, format: 'int', total: true },
    { label: 'Realizadas', value: (row) => row.completed, format: 'int', total: true },
    { label: 'Faltas', value: (row) => row.missed, format: 'int', total: true },
    { label: 'Taxa de faltas', value: missRate, format: 'pct', total: (rows) => ratio(sum(rows, 'missed'), sum(rows, 'completed') + sum(rows, 'missed')) },
    { label: 'Canc. paciente', value: (row) => row.cancelled_by_patient, format: 'int', total: true },
    { label: 'Canc. tardios', value: (row) => row.late_cancel, format: 'int', total: true },
    { label: 'Canc. clínica', value: (row) => row.cancelled_by_clinic, format: 'int', total: true },
    { label: 'Remarcadas', value: (row) => row.rescheduled, format: 'int', total: true },
    { label: 'Sem presença registrada', value: (row) => row.unrecorded, format: 'int', total: true },
    { label: 'Horas atendidas', value: (row) => Math.round((row.completed_minutes / 60) * 10) / 10, format: 'int', total: true }
  ];

  const noteRows = [...new Set(scopedNotes.map((row) => row.professional_name))].sort().map((name) => {
    const items = scopedNotes.filter((row) => row.professional_name === name);
    return {
      name, total: items.length, onTime: items.filter((row) => row.note_status === 'final').length,
      late: items.filter((row) => row.note_status === 'final_late').length,
      open: items.filter((row) => row.note_status === 'pending' || row.note_status === 'draft').length,
      overdue: items.filter((row) => row.overdue).length
    };
  });

  return (
    <>
      <Heading title={title} lead={period.label}><PrintButton /></Heading>
      {filters}

      <section className="numbers" aria-label="Resumo do período">
        <Stat value={formatValue(totals?.completed ?? 0, 'int')} label="sessões realizadas" />
        <Stat value={formatValue(totals ? missRate(totals) : null, 'pct')} label="taxa de faltas (faltas ÷ realizadas + faltas)" />
        <Stat value={formatValue(totals ? ratio(cancelled, totals.total) : null, 'pct')} label="das sessões marcadas foram canceladas" />
        <Stat value={formatValue(totals ? ratio(totals.rescheduled, totals.total) : null, 'pct')} label="foram remarcadas" />
        <Stat value={formatValue(totals ? Math.round(totals.completed_minutes / 6) / 10 : 0, 'int')} label="horas atendidas" />
        <Stat value={formatValue(totals?.unrecorded ?? 0, 'int')} label="sessões sem presença registrada" danger={(totals?.unrecorded ?? 0) > 0} />
      </section>

      <div className="tabs spaced-tabs no-print" role="tablist" aria-label="Agrupar sessões por">
        {([['professional', 'Por profissional'], ['type', 'Por tipo'], ['modality', 'Por modalidade']] as [Group, string][])
          .filter(([key]) => all || key !== 'professional').map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={group === key} className={group === key ? 'tab on' : 'tab'} onClick={() => setGroup(key)}>{label}</button>
          ))}
      </div>
      <ReportTable title="Sessões" rows={grouped} columns={sessionColumns} fileName={`sessoes-${period.from}-${period.to}`}
        empty="Nenhuma sessão no período." note="Cancelamento tardio: pelo paciente, dentro da antecedência mínima da política de cobrança." />

      <section className="numbers" aria-label="Pacientes">
        <Stat value={formatValue(patients.status.active, 'int')} label={`pacientes ${patientStatusLabel.active.toLowerCase()} hoje`} />
        <Stat value={formatValue(patients.status.paused, 'int')} label="em pausa" />
        <Stat value={formatValue(patients.status.discharged, 'int')} label="com alta" />
        <Stat value={formatValue(patients.registered, 'int')} label="cadastrados no período" />
      </section>
      <ReportTable title="Retenção de pacientes novos" rows={patients.retention} fileName={`retencao-${period.from}-${period.to}`}
        empty="Nenhum paciente começou no período."
        note="Pacientes cuja primeira sessão realizada caiu no período. Retido em 4 (ou 12) semanas: teve outra sessão realizada 4 (ou 12) semanas depois ou mais. Só conta quem já teve tempo para isso."
        columns={[
          { label: 'Profissional', value: (row) => row.name },
          { label: 'Começaram', value: (row) => row.started, format: 'int', total: true },
          { label: 'Retidos em 4 semanas', value: (row) => ratio(row.kept_4, row.eligible_4), format: 'pct',
            total: (rows) => ratio(rows.reduce((s, r) => s + r.kept_4, 0), rows.reduce((s, r) => s + r.eligible_4, 0)) },
          { label: 'Retidos em 12 semanas', value: (row) => ratio(row.kept_12, row.eligible_12), format: 'pct',
            total: (rows) => ratio(rows.reduce((s, r) => s + r.kept_12, 0), rows.reduce((s, r) => s + r.eligible_12, 0)) }
        ]} />

      <ReportTable title="Prontuários (sessões realizadas no período)" rows={noteRows} fileName={`prontuarios-${period.from}-${period.to}`}
        empty="Nenhuma sessão realizada no período." note="Só a situação de preenchimento; nenhum conteúdo clínico."
        columns={[
          { label: 'Profissional', value: (row) => row.name },
          { label: 'Sessões', value: (row) => row.total, format: 'int', total: true },
          { label: 'Finalizadas no prazo', value: (row) => ratio(row.onTime, row.total), format: 'pct',
            total: (rows) => ratio(rows.reduce((s, r) => s + r.onTime, 0), rows.reduce((s, r) => s + r.total, 0)) },
          { label: 'Fora do prazo', value: (row) => row.late, format: 'int', total: true },
          { label: 'Em aberto', value: (row) => row.open, format: 'int', total: true },
          { label: 'Atrasadas agora', value: (row) => row.overdue, format: 'int', total: true }
        ]} />

    </>
  );
}
