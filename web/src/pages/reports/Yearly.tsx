import { useState } from 'react';
import type { YearRow } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { BarChart } from '../../components/BarChart.tsx';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { change, monthLabel } from '../../format.ts';
import { useLoad } from '../../hooks.ts';
import { PrintButton, downloadCsv, formatValue, ratio } from './shared.tsx';

type Metric = 'billed' | 'received' | 'expenses_paid' | 'cash_result' | 'completed' | 'miss_rate' | 'new_patients' | 'leads' | 'conversion';
interface MetricDef { key: Metric; label: string; money?: true; rate?: true; lowerIsBetter?: true; month: (row: YearRow) => number | null; total: (rows: YearRow[]) => number | null }

const sum = (rows: YearRow[], key: keyof Omit<YearRow, 'month'>) =>
  rows.some((row) => row[key] !== null) ? rows.reduce((total, row) => total + Number(row[key] ?? 0), 0) : null;
const simple = (key: keyof Omit<YearRow, 'month'>) => ({ month: (row: YearRow) => row[key], total: (rows: YearRow[]) => sum(rows, key) });

const METRICS: MetricDef[] = [
  { key: 'billed', label: 'Faturado', money: true, ...simple('billed') },
  { key: 'received', label: 'Recebido', money: true, ...simple('received') },
  { key: 'expenses_paid', label: 'Despesas pagas', money: true, lowerIsBetter: true, ...simple('expenses_paid') },
  { key: 'cash_result', label: 'Resultado de caixa', money: true, ...simple('cash_result') },
  { key: 'completed', label: 'Sessões realizadas', ...simple('completed') },
  {
    key: 'miss_rate', label: 'Taxa de faltas', rate: true, lowerIsBetter: true,
    month: (row) => (row.completed === null ? null : ratio(row.missed ?? 0, row.completed + (row.missed ?? 0))),
    total: (rows) => { const done = sum(rows, 'completed'); return done === null ? null : ratio(sum(rows, 'missed') ?? 0, done + (sum(rows, 'missed') ?? 0)); }
  },
  { key: 'new_patients', label: 'Novos pacientes', ...simple('new_patients') },
  { key: 'leads', label: 'Leads', ...simple('leads') },
  {
    key: 'conversion', label: 'Conversão comercial', rate: true,
    month: (row) => (row.leads === null ? null : ratio(row.converted ?? 0, row.leads)),
    total: (rows) => { const leads = sum(rows, 'leads'); return leads === null ? null : ratio(sum(rows, 'converted') ?? 0, leads); }
  }
];

const show = (metric: MetricDef, value: number | null) => formatValue(value, metric.money ? 'money' : metric.rate ? 'pct' : 'int');

// Comparativo entre dois anos, mês a mês e no acumulado. Cada indicador só aparece para quem pode vê-lo.
export function YearlyReportPage() {
  const current = new Date().getFullYear();
  const [yearA, setYearA] = useState(current);
  const [yearB, setYearB] = useState(current - 1);
  const [metric, setMetric] = useState<Metric | null>(null);
  const { data, error } = useLoad(() => Promise.all([api.reportYear(yearA), api.reportYear(yearB)]), [yearA, yearB]);
  const years = Array.from({ length: 6 }, (_, index) => current - index);
  const tools = (
    <>
      <label className="field-inline no-print">Ano
        <select className="input compact" value={yearA} onChange={(event) => setYearA(Number(event.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
      </label>
      <label className="field-inline no-print">comparado a
        <select className="input compact" value={yearB} onChange={(event) => setYearB(Number(event.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
      </label>
      <PrintButton />
    </>
  );
  if (!data) return <><Heading title="Comparativo anual">{tools}</Heading><PanelState error={error} loading={!error} empty="" /></>;

  const [a, b] = data;
  const available = METRICS.filter((item) => item.total(a) !== null);
  const selected = available.find((item) => item.key === metric) ?? available[0];
  // Acumulado até o mesmo mês nos dois anos, quando o ano atual ainda não terminou.
  const lastMonth = yearA === current ? new Date().getMonth() : 11;
  const toDate = (rows: YearRow[]) => rows.slice(0, lastMonth + 1);

  const exportCsv = () => downloadCsv(`comparativo-${yearA}-${yearB}`, ['Indicador', 'Mês', String(yearA), String(yearB)],
    available.flatMap((item) => a.map((row, index) => [item.label, monthLabel(row.month).split(' ')[0],
      String(item.month(row) ?? '').replace('.', ','), String(item.month(b[index]) ?? '').replace('.', ',')])));

  return (
    <>
      <Heading title="Comparativo anual" lead={`${yearA} x ${yearB}${lastMonth < 11 ? `, acumulado até ${monthLabel(a[lastMonth].month).split(' ')[0].toLowerCase()}` : ''}`}>{tools}</Heading>
      {!available.length && <p className="notice">Seu perfil não tem indicadores para comparar.</p>}

      {available.length > 0 && <>
        <Panel title="Indicadores no acumulado" tools={<button type="button" className="link-btn no-print" onClick={exportCsv}>Exportar CSV</button>}>
          <div className="table-wrap">
            <table className="table report-table">
              <thead><tr><th>Indicador</th><th className="num">{yearA}</th><th className="num">{yearB}</th><th className="num">Variação</th><th className="no-print"><span className="sr-only">Gráfico</span></th></tr></thead>
              <tbody>
                {available.map((item) => {
                  const va = item.total(toDate(a));
                  const vb = item.total(toDate(b));
                  const delta = va === null || vb === null ? null : item.rate ? va - vb : change(va, vb);
                  const good = delta === null || delta === 0 ? undefined : (delta > 0) !== Boolean(item.lowerIsBetter);
                  return (
                    <tr key={item.key} className={item.key === selected.key ? 'selected-row' : undefined}>
                      <td>{item.label}</td>
                      <td className="num">{show(item, va)}</td>
                      <td className="num">{show(item, vb)}</td>
                      <td className={`num ${good === undefined ? '' : good ? 'delta-good' : 'delta-bad'}`}>
                        {delta === null ? '—' : `${delta > 0 ? '▲' : delta < 0 ? '▼' : ''} ${Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}${item.rate ? ' p.p.' : '%'}`}
                      </td>
                      <td className="no-print"><button type="button" className="link-btn" aria-pressed={item.key === selected.key} onClick={() => setMetric(item.key)}>Ver mês a mês</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small panel-note">Sem histórico anterior ao sistema: anos e meses sem dados aparecem zerados.</p>
        </Panel>

        <Panel title={`${selected.label}: mês a mês`}>
          <div className="panel-body">
            <BarChart label={`${selected.label} por mês, ${yearA} e ${yearB}`}
              labels={a.map((row) => monthLabel(row.month, 'short').slice(0, 3))} fullLabels={a.map((row) => monthLabel(row.month).split(' ')[0])}
              series={[{ label: String(yearA), values: a.map(selected.month) }, { label: String(yearB), values: b.map(selected.month) }]}
              format={(value) => show(selected, value)} />
            {selected.key === 'cash_result' && <p className="muted small">Meses com resultado negativo aparecem sem barra; os valores estão em "Ver tabela".</p>}
          </div>
        </Panel>
      </>}
    </>
  );
}
