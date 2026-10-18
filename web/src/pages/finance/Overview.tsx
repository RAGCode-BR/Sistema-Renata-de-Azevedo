import { useState } from 'react';
import { api } from '../../api.ts';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { change, money, monthLabel, plural } from '../../format.ts';
import { useLoad } from '../../hooks.ts';
import { CashChart } from './CashChart.tsx';

// Visão geral do financeiro (finance.view: Proprietário(a) e Financeiro). Faturado = competência;
// recebido, despesas pagas e repasses = caixa. Resultado de caixa = recebido − despesas pagas − repasses.
export function FinanceOverviewPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const { data, error } = useLoad(() => Promise.all([
    api.financeSummary(year), api.financeSummary(year - 1), api.receivables(), api.expenseBreakdown(year)
  ]), [year]);

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];
  const tools = (
    <>
      <label className="field-inline">Mês
        <select className="input compact" value={monthIndex} onChange={(event) => setMonthIndex(Number(event.target.value))}>
          {Array.from({ length: 12 }, (_, index) => (
            <option key={index} value={index}>{monthLabel(`${year}-${String(index + 1).padStart(2, '0')}-01`).split(' ')[0]}</option>
          ))}
        </select>
      </label>
      <label className="field-inline">Ano
        <select className="input compact" value={year} onChange={(event) => setYear(Number(event.target.value))}>
          {years.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    </>
  );

  if (!data) return <><Heading title="Visão geral" lead="Faturamento, recebimentos, despesas e resultado.">{tools}</Heading><PanelState error={error} loading={!error} empty="" /></>;

  const [months, lastYear, receivables, breakdown] = data;
  const month = months[monthIndex];
  const previous = monthIndex ? months[monthIndex - 1] : lastYear[11];
  const sameLastYear = lastYear[monthIndex];
  const centers = breakdown.filter((item) => item.dimension === 'cost_center');
  const categories = breakdown.filter((item) => item.dimension === 'category');
  const yearTotals = months.reduce((sum, item) => ({
    billed: sum.billed + item.billed, received: sum.received + item.received, result: sum.result + item.cash_result
  }), { billed: 0, received: 0, result: 0 });

  return (
    <>
      <Heading title="Visão geral" lead={`${monthLabel(month.month)}. Faturado pela data da sessão; recebido e pago pela data do caixa.`}>{tools}</Heading>

      <section className="numbers finance-numbers" aria-label={`Indicadores de ${monthLabel(month.month)}`}>
        <Kpi label="faturado" value={month.billed} previous={previous.billed} lastYear={sameLastYear.billed} />
        <Kpi label="recebido" value={month.received} previous={previous.received} lastYear={sameLastYear.received} />
        <Kpi label="despesas pagas" value={month.expenses_paid} previous={previous.expenses_paid} lastYear={sameLastYear.expenses_paid} lowerIsBetter />
        <Kpi label="repasses pagos" value={month.payouts_paid} previous={previous.payouts_paid} lastYear={sameLastYear.payouts_paid} lowerIsBetter />
        <Kpi label="resultado de caixa" value={month.cash_result} previous={previous.cash_result} lastYear={sameLastYear.cash_result} />
        <a className="number" href="#/cobrancas">
          <strong>{money(receivables.open_amount)}</strong>
          <span>a receber hoje{receivables.overdue_count > 0 && <>, <b className="text-danger">{money(receivables.overdue_amount)} vencido</b> em {plural(receivables.overdue_count, 'cobrança', 'cobranças')}</>}</span>
        </a>
      </section>

      <Panel title={`Entradas e saídas em ${year}`}
        tools={<span className="muted small">No ano: faturado {money(yearTotals.billed)} · recebido {money(yearTotals.received)} · resultado {money(yearTotals.result)}</span>}>
        <div className="panel-body"><CashChart months={months} /></div>
      </Panel>

      <div className="finance-split">
        <Breakdown title={`Despesas por centro de custo (${year})`} items={centers} />
        <Breakdown title={`Despesas por categoria (${year})`} items={categories} />
      </div>
    </>
  );
}

function Kpi({ label, value, previous, lastYear, lowerIsBetter = false }: {
  label: string; value: number; previous: number; lastYear: number; lowerIsBetter?: boolean;
}) {
  return (
    <div className="number">
      <strong className={value < 0 ? 'text-danger' : undefined}>{money(value)}</strong>
      <span>{label}</span>
      <span className="kpi-compare">
        <Delta label="mês anterior" value={change(value, previous)} lowerIsBetter={lowerIsBetter} />
        <Delta label="mesmo mês do ano passado" value={change(value, lastYear)} lowerIsBetter={lowerIsBetter} />
      </span>
    </div>
  );
}

function Delta({ label, value, lowerIsBetter }: { label: string; value: number | null; lowerIsBetter: boolean }) {
  if (value === null) return <small>— vs {label}</small>;
  const good = lowerIsBetter ? value <= 0 : value >= 0;
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '';
  return (
    <small className={value === 0 ? undefined : good ? 'delta-good' : 'delta-bad'}>
      {arrow} {Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% vs {label}
    </small>
  );
}

function Breakdown({ title, items }: { title: string; items: { name: string; amount: number }[] }) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return (
    <Panel title={title}>
      {items.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nome</th><th className="num">Valor</th><th className="share-col">Participação</th></tr></thead>
            <tbody>
              {items.map((item) => {
                const share = total ? (item.amount / total) * 100 : 0;
                return (
                  <tr key={item.name}>
                    <td>{item.name}</td>
                    <td className="num">{money(item.amount)}</td>
                    <td className="share-col">
                      <span className="share"><span style={{ width: `${share}%` }} /></span>
                      <span className="share-value">{share.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="empty-state">Nenhuma despesa lançada neste ano.</p>}
    </Panel>
  );
}
