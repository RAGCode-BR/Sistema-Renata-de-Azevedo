import { Select } from '../components/Select.tsx';
import { useMemo, useState } from 'react';
import type { NoteFillStatus } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { addDays, dateTime, longDay, plural, startOfMonth, startOfToday, time } from '../format.ts';
import { useLoad } from '../hooks.ts';

const STATUS_LABEL: Record<NoteFillStatus, string> = {
  pending: 'Pendente',
  draft: 'Rascunho',
  final: 'Finalizado',
  final_late: 'Finalizado fora do prazo'
};

type Period = '30' | 'month' | 'previous';

function periodRange(period: Period): { from: Date; to: Date } {
  const today = startOfToday();
  if (period === 'month') return { from: startOfMonth(today), to: addDays(today, 1) };
  if (period === 'previous') {
    const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { from, to: startOfMonth(today) };
  }
  return { from: addDays(today, -30), to: addDays(today, 1) };
}

// Controle administrativo do preenchimento: quais sessões realizadas estão sem evolução, em rascunho,
// finalizadas ou finalizadas fora do prazo. Sem nenhum conteúdo clínico (clinical_note_status).
export function RecordControlPage() {
  const [period, setPeriod] = useState<Period>('30');
  const [professional, setProfessional] = useState('');
  const [status, setStatus] = useState<NoteFillStatus | 'overdue' | ''>('');
  const range = useMemo(() => periodRange(period), [period]);
  const { data, error } = useLoad(() => Promise.all([api.noteStatus(range.from, range.to), api.settings()]), [range]);
  const [rows, settings] = data ?? [[], null];
  const professionals = [...new Map(rows.map((row) => [row.professional_id, row.professional_name])).entries()];
  const scoped = rows.filter((row) => !professional || row.professional_id === professional);
  const visible = scoped.filter((row) => !status || (status === 'overdue' ? row.overdue : row.note_status === status));
  const count = (value: NoteFillStatus) => scoped.filter((row) => row.note_status === value).length;

  return (
    <>
      <Heading title="Controle de prontuários"
        lead={`Preenchimento das sessões realizadas, sem acesso ao conteúdo.${settings ? ` Prazo: ${plural(settings.note_deadline_hours, 'hora', 'horas')} após a sessão.` : ''}`}>
        <Select className="input compact" aria-label="Período" value={period} onChange={(event) => setPeriod(event.target.value as Period)}>
          <option value="30">Últimos 30 dias</option>
          <option value="month">Este mês</option>
          <option value="previous">Mês anterior</option>
        </Select>
        <Select className="input compact" aria-label="Profissional" value={professional} onChange={(event) => setProfessional(event.target.value)}>
          <option value="">Todas as profissionais</option>
          {professionals.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
      </Heading>

      <section className="numbers" aria-label="Resumo">
        {([['pending', count('pending')], ['draft', count('draft')], ['overdue', scoped.filter((row) => row.overdue).length],
          ['final_late', count('final_late')], ['final', count('final')]] as const).map(([key, value]) => (
          <button key={key} type="button" className={status === key ? 'number selected' : 'number'} aria-pressed={status === key}
            onClick={() => setStatus(status === key ? '' : key)}>
            <strong>{data ? value : '–'}</strong>
            <span>{key === 'overdue' ? 'atrasadas (prazo vencido)' : STATUS_LABEL[key].toLowerCase()}</span>
          </button>
        ))}
      </section>

      <Panel title={status ? `Sessões: ${status === 'overdue' ? 'atrasadas' : STATUS_LABEL[status].toLowerCase()}` : 'Sessões realizadas'}>
        {visible.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Sessão</th><th>Paciente</th><th>Profissional</th><th>Situação do registro</th><th>Prazo</th></tr></thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.appointment_id}>
                    <td>{longDay(row.starts_at)}, {time(row.starts_at)}</td>
                    <td>{row.patient_name}</td>
                    <td>{row.professional_name}</td>
                    <td><span className={`fill fill-${row.note_status}${row.overdue ? ' overdue' : ''}`}>{STATUS_LABEL[row.note_status]}{row.overdue ? ' · atrasado' : ''}</span></td>
                    <td>{dateTime(row.deadline_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhuma sessão realizada com esses filtros." />}
      </Panel>
    </>
  );
}
