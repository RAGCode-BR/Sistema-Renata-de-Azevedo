import { useState } from 'react';
import { Alert, View } from 'react-native';
import { can } from '../../../shared/permissions.ts';
import type { Charge, PaymentMethod } from '../../../shared/types.ts';
import { dayLabel, money, parseMoney, paymentMethodLabel, todayKey } from '../../../shared/format.ts';
import { Button, Card, Field, Muted, Row, Screen, State, Tabs } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/supabase';
import { message, useLoad, useReloadOnFocus } from '../lib/useLoad';

const METHODS: PaymentMethod[] = ['pix', 'cash', 'debit', 'credit', 'transfer'];

// Cobranças em aberto e registro de pagamento (mesmas regras do sistema: o que sobrar vira crédito).
export default function Charges() {
  const { user } = useAuth();
  const manage = can(user!, 'billing.manage');
  const { data, error, loading, reload } = useLoad(() => api.charges(null, null, { open: true }), []);
  useReloadOnFocus(reload);
  const [paying, setPaying] = useState<Charge | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('pix');
  const [busy, setBusy] = useState(false);
  const charges = [...(data ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date));

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <State error={error} loading={!data && loading} empty={data && !charges.length ? 'Nenhuma cobrança em aberto.' : undefined} />
      {paying && (
        <Card title={`Receber de ${paying.patient_name}`}>
          <Muted>{paying.description} · em aberto {money(paying.balance)}</Muted>
          <View style={{ height: 8 }} />
          <Field label="Valor recebido" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={String(paying.balance).replace('.', ',')} />
          <Tabs value={method} onChange={setMethod} options={METHODS.slice(0, 3).map((key) => [key, paymentMethodLabel[key]])} />
          <Tabs value={method} onChange={setMethod} options={METHODS.slice(3).map((key) => [key, paymentMethodLabel[key]])} />
          <Button label="Registrar pagamento" busy={busy} disabled={!amount} onPress={async () => {
            const value = parseMoney(amount);
            if (Number.isNaN(value) || value <= 0) { Alert.alert('Valor inválido', 'Informe um valor como 150,00.'); return; }
            setBusy(true);
            try {
              await api.registerPayment({ patientId: paying.patient_id, amount: value, method, receivedAt: todayKey(), chargeIds: [paying.id], notes: 'Registrado pelo aplicativo' });
              Alert.alert('Pagamento registrado', value > paying.balance ? `${money(value - paying.balance)} ficaram como crédito.` : '');
              setPaying(null); setAmount(''); reload();
            } catch (failure) { Alert.alert('Não foi possível', message(failure)); } finally { setBusy(false); }
          }} />
          <Button label="Cancelar" variant="light" onPress={() => setPaying(null)} />
        </Card>
      )}
      {charges.length > 0 && (
        <Card>
          {charges.map((item) => (
            item.status === 'unpriced'
              ? <Row key={item.id} title={`${item.patient_name} · valor a definir`} detail={`${item.description}. Defina o valor no sistema web.`} tone="warning" />
              : <Row key={item.id} title={`${item.patient_name} · ${money(item.balance)}`} detail={`${item.description} · vence ${dayLabel(item.due_date)}`}
                  tone={item.status === 'overdue' ? 'danger' : undefined}
                  onPress={manage ? () => { setPaying(item); setAmount(''); } : undefined} />
          ))}
        </Card>
      )}
      {manage && <Muted>Toque numa cobrança para registrar o pagamento. Estornos, ajustes e o restante do financeiro ficam no sistema web.</Muted>}
    </Screen>
  );
}
