import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { DreRow, ExpenseReportRow, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Heading, PanelState } from '../../components/Page.tsx';
import { dayLabel, monthLabel, paymentMethodLabel, sessionTypeLabel } from '../../format.ts';
import { useLoad } from '../../hooks.ts';
import { PrintButton, ReportTable, Stat, formatValue, ratio, usePeriod } from './shared.tsx';
import type { Column } from './shared.tsx';

type Tab = 'dre' | 'previsao' | 'faturamento' | 'despesas' | 'repasses' | 'formas' | 'inadimplencia';
const TABS: [Tab, string, 'finance' | 'billing'][] = [
  ['dre', 'DRE', 'finance'], ['previsao', 'Previsão', 'finance'], ['faturamento', 'Por profissional', 'finance'], ['despesas', 'Despesas', 'finance'],
  ['repasses', 'Repasses', 'finance'], ['formas', 'Formas de pagamento', 'billing'], ['inadimplencia', 'Inadimplência', 'billing']
];

// Relatórios financeiros. DRE, faturamento por profissional, despesas e repasses: finance.view.
// Formas de pagamento e inadimplência: billing.view (inclui Gerente e Recepção).
export function FinancialReportPage({ user }: { user: SessionUser }) {
  const finance = can(user, 'finance.view');
  const tabs = TABS.filter(([, , need]) => (need === 'finance' ? finance : can(user, 'billing.view') || finance));
  const [tab, setTab] = useState<Tab>(tabs[0][0]);
  const { period, control } = usePeriod(finance ? 'ano' : 'mes');

  return (
    <>
      <Heading title="Relatório financeiro" lead={tab === 'inadimplencia' ? 'Situação de hoje' : tab === 'previsao' ? 'Saldos já lançados, organizados por vencimento' : period.label}><PrintButton /></Heading>
      <div className="tabs spaced-tabs no-print" role="tablist" aria-label="Relatórios financeiros">
        {tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'tab on' : 'tab'} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      {tab !== 'inadimplencia' && tab !== 'previsao' && control}
      {tab === 'dre' && <Dre from={period.from} to={period.to} />}
      {tab === 'previsao' && <Forecast />}
      {tab === 'faturamento' && <Revenue from={period.from} to={period.to} />}
      {tab === 'despesas' && <Expenses from={period.from} to={period.to} />}
      {tab === 'repasses' && <Payouts from={period.from} to={period.to} />}
      {tab === 'formas' && <Methods from={period.from} to={period.to} />}
      {tab === 'inadimplencia' && <Aging />}
    </>
  );
}

function Forecast() {
  const { data, error } = useLoad(() => api.financeForecast(12), []);
  if (!data) return <PanelState error={error} loading={!error} empty="" />;
  const overdue = data.find((row) => row.month === null);
  const upcoming = data.filter((row) => row.month !== null);
  const sum = (key: 'expected_in' | 'planned_out' | 'net') => upcoming.reduce((total, row) => total + row[key], 0);
  return (
    <>
      <section className="numbers" aria-label="Resumo da previsão">
        <Stat value={formatValue(sum('expected_in'), 'money')} label="a receber nos próximos 12 meses" />
        <Stat value={formatValue(sum('planned_out'), 'money')} label="a pagar nos próximos 12 meses" />
        <Stat value={formatValue(sum('net'), 'money')} label="saldo programado" danger={sum('net') < 0} />
        <Stat value={formatValue((overdue?.expected_in ?? 0) - (overdue?.planned_out ?? 0), 'money')} label="saldo vencido" />
      </section>
      <ReportTable title="Previsão por vencimento" rows={data} fileName="previsao-financeira" empty="Sem lançamentos previstos."
        note="Considera somente cobranças com saldo em aberto e despesas ainda não pagas. Valores vencidos aparecem separados. Sessões ainda não cobradas, pagamentos futuros não lançados e repasses futuros não entram nesta previsão."
        columns={[
          { label: 'Período', value: (row) => row.month ? monthLabel(row.month) : 'Vencidos até hoje' },
          { label: 'Entradas previstas', value: (row) => row.expected_in, format: 'money' },
          { label: 'Saídas previstas', value: (row) => row.planned_out, format: 'money' },
          { label: 'Saldo', value: (row) => row.net, format: 'money' }
        ]} />
    </>
  );
}

function Dre({ from, to }: { from: string; to: string }) {
  const { data, error } = useLoad(() => api.reportDre(from, to), [from, to]);
  if (!data) return <PanelState error={error} loading={!error} empty="" />;
  const categories = [...new Set(data.flatMap((row) => Object.keys(row.categories)))].sort();
  const net = (row: DreRow) => row.billed - row.discounts;
  const competence = (row: DreRow) => net(row) - row.expenses_competence - row.payouts_competence;
  const cash = (row: DreRow) => row.received - row.expenses_paid - row.payouts_paid;
  const total = (fn: (row: DreRow) => number) => data.reduce((sum, row) => sum + fn(row), 0);
  const columns: Column<DreRow>[] = [
    { label: 'Mês', value: (row) => monthLabel(row.month) },
    { label: 'Faturado', value: (row) => row.billed, format: 'money', total: true },
    { label: 'Descontos', value: (row) => -row.discounts, format: 'money', total: true },
    { label: 'Receita líquida', value: net, format: 'money', total: true },
    ...categories.map((name): Column<DreRow> => ({ label: name, value: (row) => -(row.categories[name] ?? 0), format: 'money', total: true })),
    { label: 'Repasses', value: (row) => -row.payouts_competence, format: 'money', total: true },
    { label: 'Resultado (competência)', value: competence, format: 'money', total: true },
    { label: 'Recebido', value: (row) => row.received, format: 'money', total: true },
    { label: 'Despesas pagas', value: (row) => -row.expenses_paid, format: 'money', total: true },
    { label: 'Repasses pagos', value: (row) => -row.payouts_paid, format: 'money', total: true },
    { label: 'Resultado (caixa)', value: cash, format: 'money', total: true }
  ];
  return (
    <>
      <section className="numbers" aria-label="Resumo">
        <Stat value={formatValue(total(net), 'money')} label="receita líquida (competência)" />
        <Stat value={formatValue(total(competence), 'money')} label="resultado por competência" danger={total(competence) < 0} />
        <Stat value={formatValue(total((row) => row.received), 'money')} label="recebido no caixa" />
        <Stat value={formatValue(total(cash), 'money')} label="resultado de caixa" danger={total(cash) < 0} />
      </section>
      <ReportTable title="DRE simplificada" rows={data} columns={columns} fileName={`dre-${from}-${to}`} empty="Sem movimento no período."
        note="Competência: o mês da sessão, da despesa e do repasse fechado. Caixa: o mês em que o dinheiro entrou ou saiu. Repasses de meses ainda não fechados não entram." />
    </>
  );
}

function Revenue({ from, to }: { from: string; to: string }) {
  const { data, error } = useLoad(() => api.reportRevenue(from, to), [from, to]);
  if (!data) return <PanelState error={error} loading={!error} empty="" />;
  return (
    <ReportTable title="Faturado e recebido por profissional e tipo" rows={data} fileName={`faturamento-${from}-${to}`} empty="Sem cobranças no período."
      note="Faturado: cobranças com competência no período (sem as canceladas). Recebido: pagamentos do período alocados a essas cobranças."
      columns={[
        { label: 'Profissional', value: (row) => row.professional_name ?? 'Receita da clínica' },
        { label: 'Tipo', value: (row) => (row.session_type ? sessionTypeLabel[row.session_type] : 'Cobrança avulsa') },
        { label: 'Cobranças', value: (row) => row.charges, format: 'int', total: true },
        { label: 'Faturado', value: (row) => row.billed, format: 'money', total: true },
        { label: 'Recebido', value: (row) => row.received, format: 'money', total: true }
      ]} />
  );
}

function Expenses({ from, to }: { from: string; to: string }) {
  const previousYear = (date: string) => {
    const year = Number(date.slice(0, 4)) - 1;
    return date.slice(5) === '02-29' ? `${year}-02-28` : `${year}${date.slice(4)}`;
  };
  const { data, error } = useLoad(() => Promise.all([
    api.reportExpenses(from, to), api.reportExpenses(previousYear(from), previousYear(to))
  ]), [from, to]);
  if (!data) return <PanelState error={error} loading={!error} empty="" />;
  const [current, previous] = data;
  const part = (dimension: 'category' | 'cost_center', title: string) => {
    type ComparedExpense = ExpenseReportRow & { previous: number };
    const rowsByName = new Map<string, ComparedExpense>();
    for (const row of previous.filter((item) => item.dimension === dimension)) {
      rowsByName.set(row.name, { ...row, competence: 0, paid: 0, previous: row.competence });
    }
    for (const row of current.filter((item) => item.dimension === dimension)) {
      const prior = rowsByName.get(row.name);
      rowsByName.set(row.name, { ...row, previous: prior?.previous ?? 0 });
    }
    const rows = [...rowsByName.values()].sort((a, b) => b.competence - a.competence || a.name.localeCompare(b.name));
    const sum = rows.reduce((total, row) => total + row.competence, 0);
    return (
      <ReportTable title={title} rows={rows} fileName={`despesas-${dimension === 'category' ? 'categorias' : 'centros'}-${from}-${to}`} empty="Sem despesas no período."
        note="Participação: parte do total atual. Variação: comparação com o mesmo período do ano anterior; sem percentual quando a base anterior é zero."
        columns={[
          { label: 'Nome', value: (row) => row.name },
          { label: 'Competência', value: (row) => row.competence, format: 'money', total: true },
          { label: 'Participação', value: (row) => ratio(row.competence, sum), format: 'pct' },
          { label: 'Ano anterior', value: (row) => row.previous, format: 'money', total: true },
          { label: 'Variação', value: (row) => ratio(row.competence - row.previous, row.previous), format: 'pct',
            total: (items) => ratio(items.reduce((total, row) => total + row.competence - row.previous, 0),
              items.reduce((total, row) => total + row.previous, 0)) },
          { label: 'Pagas no período', value: (row) => row.paid, format: 'money', total: true }
        ]} />
    );
  };
  return <div className="finance-split">{part('category', 'Por categoria')}{part('cost_center', 'Por centro de custo')}</div>;
}

function Payouts({ from, to }: { from: string; to: string }) {
  const { data, error } = useLoad(() => api.reportPayouts(from, to), [from, to]);
  if (!data) return <PanelState error={error} loading={!error} empty="" />;
  return (
    <ReportTable title="Repasses por mês" rows={data} fileName={`repasses-${from}-${to}`} empty="Sem repasses no período."
      note="Meses ainda não fechados mostram a prévia pelo percentual atual."
      columns={[
        { label: 'Mês', value: (row) => monthLabel(row.month) },
        { label: 'Profissional', value: (row) => row.professional_name },
        { label: 'Recebido', value: (row) => row.received, format: 'money', total: true },
        { label: 'Percentual', value: (row) => row.percent, format: 'pct' },
        { label: 'Repasse', value: (row) => row.payout, format: 'money', total: true },
        { label: 'Pago em', value: (row) => (row.paid_at ? dayLabel(row.paid_at) : 'Em aberto') }
      ]} />
  );
}

function Methods({ from, to }: { from: string; to: string }) {
  const { data, error } = useLoad(() => api.reportPaymentMethods(from, to), [from, to]);
  if (!data) return <PanelState error={error} loading={!error} empty="" />;
  const sum = data.reduce((total, row) => total + row.amount, 0);
  return (
    <ReportTable title="Recebimentos por forma de pagamento" rows={data} fileName={`formas-pagamento-${from}-${to}`} empty="Sem pagamentos no período."
      columns={[
        { label: 'Forma', value: (row) => paymentMethodLabel[row.method] ?? row.method },
        { label: 'Pagamentos', value: (row) => row.payments, format: 'int', total: true },
        { label: 'Valor', value: (row) => row.amount, format: 'money', total: true },
        { label: 'Participação', value: (row) => ratio(row.amount, sum), format: 'pct' },
        { label: 'Estornado', value: (row) => row.reversed, format: 'money', total: true }
      ]} />
  );
}

function Aging() {
  const { data, error } = useLoad(api.reportAging, []);
  if (!data) return <PanelState error={error} loading={!error} empty="" />;
  const total = (key: 'up_to_30' | 'up_to_60' | 'over_60' | 'total') => data.reduce((sum, row) => sum + row[key], 0);
  return (
    <>
      <section className="numbers" aria-label="Por faixa de atraso">
        <Stat value={formatValue(total('total'), 'money')} label="em aberto hoje" />
        <Stat value={formatValue(total('up_to_30'), 'money')} label="vencido há até 30 dias" />
        <Stat value={formatValue(total('up_to_60'), 'money')} label="de 31 a 60 dias" />
        <Stat value={formatValue(total('over_60'), 'money')} label="há mais de 60 dias" danger={total('over_60') > 0} />
      </section>
      <ReportTable title="Inadimplência por paciente" rows={data} fileName="inadimplencia" empty="Nenhuma cobrança em aberto."
        columns={[
          { label: 'Paciente', value: (row) => row.patient_name },
          { label: 'Telefone', value: (row) => row.phone },
          { label: 'A vencer', value: (row) => row.not_due, format: 'money', total: true },
          { label: 'Até 30 dias', value: (row) => row.up_to_30, format: 'money', total: true },
          { label: '31 a 60 dias', value: (row) => row.up_to_60, format: 'money', total: true },
          { label: 'Mais de 60 dias', value: (row) => row.over_60, format: 'money', total: true },
          { label: 'Total', value: (row) => row.total, format: 'money', total: true },
          { label: 'Vencimento mais antigo', value: (row) => row.oldest_due, format: 'date' }
        ]} />
    </>
  );
}
