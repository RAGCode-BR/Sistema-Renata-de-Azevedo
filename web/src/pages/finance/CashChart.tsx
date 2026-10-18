import type { FinanceMonth } from '../../../../shared/types.ts';
import { BarChart } from '../../components/BarChart.tsx';
import { money, monthLabel } from '../../format.ts';

// Entradas x saídas de caixa, mês a mês.
export function CashChart({ months }: { months: FinanceMonth[] }) {
  return (
    <BarChart label="Entradas e saídas de caixa por mês"
      labels={months.map((item) => monthLabel(item.month, 'short').slice(0, 3))} fullLabels={months.map((item) => monthLabel(item.month))}
      series={[
        { label: 'Entradas (recebido)', values: months.map((item) => item.received) },
        { label: 'Saídas (despesas pagas e repasses)', values: months.map((item) => item.expenses_paid + item.payouts_paid) }
      ]}
      extra={[
        { label: 'Despesas pagas', values: months.map((item) => item.expenses_paid) },
        { label: 'Repasses', values: months.map((item) => item.payouts_paid) },
        { label: 'Resultado', values: months.map((item) => item.cash_result) }
      ]}
      format={money} />
  );
}
