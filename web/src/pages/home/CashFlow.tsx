import { useState } from 'react';
import type { CashFlowRow } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { BarChart } from '../../components/BarChart.tsx';
import { Panel, PanelState } from '../../components/Page.tsx';
import { addDays, dateKey, longDay, money, monthLabel, startOfMonth, startOfToday, startOfWeek } from '../../format.ts';
import { useLoad } from '../../hooks.ts';

type Period = 'day' | 'week' | 'month' | 'year';
const PERIODS: [Period, string][] = [['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês'], ['year', 'Ano']];
const WEEKDAYS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

// Primeiro e último dia do período que contém a data.
function rangeOf(period: Period, anchor: Date): { from: Date; to: Date } {
  if (period === 'day') return { from: anchor, to: anchor };
  if (period === 'week') { const from = startOfWeek(anchor); return { from, to: addDays(from, 6) }; }
  if (period === 'month') { const from = startOfMonth(anchor); return { from, to: new Date(from.getFullYear(), from.getMonth() + 1, 0) }; }
  return { from: new Date(anchor.getFullYear(), 0, 1), to: new Date(anchor.getFullYear(), 11, 31) };
}

function shift(period: Period, anchor: Date, step: number): Date {
  if (period === 'day') return addDays(anchor, step);
  if (period === 'week') return addDays(anchor, 7 * step);
  if (period === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
  return new Date(anchor.getFullYear() + step, 0, 1);
}

const short = (date: Date) => date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

function periodLabel(period: Period, from: Date, to: Date): string {
  if (period === 'day') { const label = longDay(from.toISOString()); return label.charAt(0).toUpperCase() + label.slice(1); }
  if (period === 'week') return `${short(from)} a ${short(to)}/${to.getFullYear()}`;
  if (period === 'month') { const label = monthLabel(dateKey(from)); return label.charAt(0).toUpperCase() + label.slice(1); }
  return String(from.getFullYear());
}

// Fluxo de caixa no Início (quem vê o financeiro): entradas, saídas e saldo do dia, semana, mês ou ano,
// com as mesmas contas da Visão geral financeira.
export function CashFlow() {
  const [period, setPeriod] = useState<Period>('month');
  const [anchor, setAnchor] = useState(startOfToday);
  const { from, to } = rangeOf(period, anchor);
  const bucket = period === 'year' ? 'month' : 'day';
  const { data, error } = useLoad(() => api.cashFlow(dateKey(from), dateKey(to), bucket), [period, dateKey(from)]);
  const rows: CashFlowRow[] = data ?? [];
  const totals = rows.reduce((sum, row) => ({
    received: sum.received + row.received, expenses: sum.expenses + row.expenses_paid, payouts: sum.payouts + row.payouts_paid
  }), { received: 0, expenses: 0, payouts: 0 });
  const out = totals.expenses + totals.payouts;
  const balance = totals.received - out;
  const isCurrent = dateKey(rangeOf(period, startOfToday()).from) === dateKey(from);

  const labels = rows.map((row) => {
    const date = new Date(`${row.bucket}T12:00:00`);
    if (period === 'year') return monthLabel(row.bucket, 'short').slice(0, 3);
    if (period === 'week') return `${WEEKDAYS[(date.getDay() + 6) % 7]} ${date.getDate()}`;
    return String(date.getDate());
  });
  const fullLabels = rows.map((row) => (period === 'year' ? monthLabel(row.bucket) : longDay(new Date(`${row.bucket}T12:00:00`).toISOString())));

  return (
    <Panel title="Fluxo de caixa" tools={
      <div className="cash-flow-tools">
        <div className="tabs" role="tablist" aria-label="Período do fluxo de caixa">
          {PERIODS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={period === key} className={period === key ? 'tab on' : 'tab'}
              onClick={() => { setPeriod(key); setAnchor(startOfToday()); }}>{label}</button>
          ))}
        </div>
      </div>
    }>
      <div className="panel-body cash-flow">
        <div className="pager cash-flow-pager">
          <button type="button" className="link-btn" aria-label="Período anterior" onClick={() => setAnchor(shift(period, anchor, -1))}>‹</button>
          <strong aria-live="polite">{periodLabel(period, from, to)}</strong>
          <button type="button" className="link-btn" aria-label="Próximo período" onClick={() => setAnchor(shift(period, anchor, 1))}>›</button>
          {!isCurrent && <button type="button" className="link-btn" onClick={() => setAnchor(startOfToday())}>Hoje</button>}
        </div>

        {error ? <PanelState error={error} loading={false} empty="" /> : (
          <>
            <div className="numbers cash-flow-numbers" aria-busy={!data}>
              <div className="number"><strong>{data ? money(totals.received) : '–'}</strong><span>entradas (recebido)</span></div>
              <div className="number"><strong>{data ? money(out) : '–'}</strong>
                <span>saídas{data && out > 0 ? ` (despesas ${money(totals.expenses)}, repasses ${money(totals.payouts)})` : ''}</span></div>
              <div className={data && balance < 0 ? 'number tone-bad' : 'number tone-good'}>
                <strong>{data ? money(balance) : '–'}</strong><span>saldo do período</span></div>
            </div>
            {period !== 'day' && data && (
              <BarChart label={`Entradas e saídas de caixa: ${periodLabel(period, from, to)}`} labels={labels} fullLabels={fullLabels}
                series={[
                  { label: 'Entradas (recebido)', values: rows.map((row) => row.received) },
                  { label: 'Saídas (despesas pagas e repasses)', values: rows.map((row) => row.expenses_paid + row.payouts_paid) }
                ]}
                extra={[{ label: 'Saldo', values: rows.map((row) => row.received - row.expenses_paid - row.payouts_paid) }]}
                format={money} />
            )}
          </>
        )}
        <p className="muted small">Pagamentos recebidos menos despesas e repasses pagos no período, como na Visão geral do Financeiro. <a href="#/financeiro">Abrir o Financeiro</a></p>
      </div>
    </Panel>
  );
}
