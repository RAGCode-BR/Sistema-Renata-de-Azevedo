import { useState } from 'react';
import { monthKey, monthLabel, money, dayLabel } from '../../../shared/format.ts';
import { Card, Row, Screen, State, Tabs } from '../components/ui';
import { api } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

// Repasse da própria profissional: mês passado e mês atual (prévia).
export default function Payout() {
  const now = new Date();
  const months = [monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), monthKey(now)];
  const [month, setMonth] = useState(months[0]);
  const { data, error, loading, reload } = useLoad(() => api.payoutStatement(month), [month]);
  const row = data?.[0];
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Tabs value={month} onChange={setMonth} options={months.map((key) => [key, monthLabel(key)])} />
      <State error={error} loading={!data && loading} empty={data && !row ? 'Sem repasse neste mês.' : undefined} />
      {row && (
        <Card>
          <Row title="Recebido das suas sessões" right={money(row.received)} />
          <Row title="Percentual" right={row.percent === null ? 'não definido' : `${row.percent.toLocaleString('pt-BR')}%`} />
          <Row title="Repasse" right={money(row.payout)} />
          <Row title="Situação" right={row.paid_at ? `Pago em ${dayLabel(row.paid_at)}` : month === months[1] ? 'Mês em andamento (prévia)' : 'A fechar'} />
        </Card>
      )}
    </Screen>
  );
}
