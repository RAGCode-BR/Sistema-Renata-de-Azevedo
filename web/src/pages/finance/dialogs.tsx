import { Select } from '../../components/Select.tsx';
import { useState } from 'react';
import type { Charge, Patient, PaymentMethod, Professional } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal } from '../../components/Modal.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dayLabel, money, parseMoney, paymentMethodLabel, todayKey } from '../../format.ts';
import { text, useLoad } from '../../hooks.ts';

const METHODS: PaymentMethod[] = ['pix', 'cash', 'debit', 'credit', 'transfer'];

export function readMoney(data: FormData, name: string, label: string, { allowZero = false } = {}): number {
  const value = parseMoney(text(data, name));
  if (Number.isNaN(value) || value < 0 || (!allowZero && value === 0)) throw new Error(`${label}: informe um valor válido (ex.: 150,00).`);
  return value;
}

// Registrar pagamento: escolhe o paciente, marca as cobranças em aberto a quitar (na ordem do
// vencimento) e o valor. O que passar do total marcado fica como crédito do paciente.
export function PaymentForm({ patients, patientId: initialPatient, chargeId, onClose, onSaved }: {
  patients: Patient[]; patientId?: string; chargeId?: string; onClose: () => void; onSaved: () => void;
}) {
  const notify = useToast();
  const [patientId, setPatientId] = useState(initialPatient ?? '');
  const open = useLoad(() => (patientId ? api.charges(null, null, { patientId, open: true }) : Promise.resolve([])), [patientId]);
  const [selected, setSelected] = useState<string[]>(chargeId ? [chargeId] : []);
  const [amountText, setAmountText] = useState('');
  const charges = [...(open.data ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const selectedTotal = charges.filter((item) => selected.includes(item.id)).reduce((sum, item) => sum + item.balance, 0);
  const amount = parseMoney(amountText);
  const leftover = Number.isNaN(amount) ? 0 : Math.max(0, amount - selectedTotal);

  return (
    <FormModal title="Registrar pagamento" submitLabel="Registrar pagamento" onClose={onClose} onSubmit={async (data) => {
      if (!patientId) throw new Error('Escolha o paciente.');
      const value = readMoney(data, 'amount', 'Valor');
      await api.registerPayment({
        patientId, amount: value, method: text(data, 'method') as PaymentMethod, receivedAt: text(data, 'receivedAt'),
        chargeIds: charges.filter((item) => selected.includes(item.id)).map((item) => item.id), notes: text(data, 'notes')
      });
      notify(leftover > 0 ? `Pagamento registrado; ${money(leftover)} ficaram como crédito.` : 'Pagamento registrado.');
      onSaved();
    }}>
      <Field label="Paciente" full>
        <Select className="input" name="patientId" value={patientId} onChange={(event) => { setPatientId(event.target.value); setSelected([]); }} required>
          <option value="" disabled>Escolha</option>
          {patients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      {patientId && (
        <fieldset className="full checks charge-picks">
          <legend>Cobranças em aberto a quitar</legend>
          {open.data && !charges.length && <p className="muted small">Nenhuma cobrança em aberto: o valor fica como crédito do paciente.</p>}
          {!open.data && <p className="muted small">Carregando…</p>}
          {charges.map((item) => (
            <label key={item.id} className="check">
              <input type="checkbox" checked={selected.includes(item.id)}
                onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />
              <span>{item.description}<span className="sub">Vence {dayLabel(item.due_date)} · em aberto {money(item.balance)}</span></span>
            </label>
          ))}
        </fieldset>
      )}
      <Field label="Valor recebido">
        <input className="input" name="amount" inputMode="decimal" required placeholder="150,00" value={amountText}
          onChange={(event) => setAmountText(event.target.value)} />
      </Field>
      <Field label="Forma de pagamento">
        <Select className="input" name="method" defaultValue="pix">
          {METHODS.map((method) => <option key={method} value={method}>{paymentMethodLabel[method]}</option>)}
        </Select>
      </Field>
      <Field label="Data do recebimento"><input className="input" name="receivedAt" type="date" required max={todayKey()} defaultValue={todayKey()} /></Field>
      <Field label="Observação (opcional)"><input className="input" name="notes" maxLength={200} /></Field>
      {selectedTotal > 0 && (
        <p className="muted small full">
          Marcado: {money(selectedTotal)}.{' '}
          {leftover > 0 ? `Sobram ${money(leftover)} como crédito do paciente.` : !Number.isNaN(amount) && amount < selectedTotal ? 'O valor quita as cobranças na ordem do vencimento; o restante continua em aberto.' : ''}
        </p>
      )}
    </FormModal>
  );
}

export function NewChargeForm({ patients, professionals, onClose, onSaved }: {
  patients: Patient[]; professionals: Professional[]; onClose: () => void; onSaved: () => void;
}) {
  const notify = useToast();
  return (
    <FormModal title="Nova cobrança" submitLabel="Criar cobrança" onClose={onClose} onSubmit={async (data) => {
      await api.createCharge({
        patientId: text(data, 'patientId'), professionalId: text(data, 'professionalId') || null, description: text(data, 'description'),
        amount: readMoney(data, 'amount', 'Valor'), competenceDate: text(data, 'competence'), dueDate: text(data, 'due')
      });
      notify('Cobrança criada.');
      onSaved();
    }}>
      <Field label="Paciente">
        <Select className="input" name="patientId" required defaultValue="">
          <option value="" disabled>Escolha</option>
          {patients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      <Field label="Profissional (para o repasse)">
        <Select className="input" name="professionalId" defaultValue="">
          <option value="">Nenhuma (receita da clínica)</option>
          {professionals.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      <Field label="Descrição" full><input className="input" name="description" required maxLength={200} placeholder="Ex.: Pacote de 4 sessões, relatório" /></Field>
      <Field label="Valor"><input className="input" name="amount" inputMode="decimal" required placeholder="300,00" /></Field>
      <Field label="Competência"><input className="input" name="competence" type="date" required defaultValue={todayKey()} /></Field>
      <Field label="Vencimento"><input className="input" name="due" type="date" required defaultValue={todayKey()} /></Field>
      <p className="muted small full">Se o paciente tiver crédito, ele é abatido desta cobrança automaticamente.</p>
    </FormModal>
  );
}

export function AdjustChargeForm({ charge, onClose, onSaved }: { charge: Charge; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  return (
    <FormModal title="Ajustar cobrança" submitLabel="Salvar" onClose={onClose} onSubmit={async (data) => {
      await api.updateCharge(charge.id, {
        amount: readMoney(data, 'amount', 'Valor', { allowZero: true }), discount: readMoney(data, 'discount', 'Desconto', { allowZero: true }),
        dueDate: text(data, 'due'), description: text(data, 'description')
      });
      notify('Cobrança ajustada.');
      onSaved();
    }}>
      <p className="modal-text full">{charge.patient_name} · já recebido {money(charge.paid)}</p>
      <Field label="Descrição" full><input className="input" name="description" required defaultValue={charge.description} /></Field>
      <Field label="Valor"><input className="input" name="amount" inputMode="decimal" required defaultValue={String(charge.amount).replace('.', ',')} /></Field>
      <Field label="Desconto"><input className="input" name="discount" inputMode="decimal" required defaultValue={String(charge.discount).replace('.', ',')} /></Field>
      <Field label="Vencimento"><input className="input" name="due" type="date" required defaultValue={charge.due_date} /></Field>
    </FormModal>
  );
}

// Cancelar cobrança ou estornar pagamento: pedem motivo e ficam no histórico.
export function ReasonForm({ title, submitLabel, intro, onSubmit, onClose }: {
  title: string; submitLabel: string; intro: string; onSubmit: (reason: string) => Promise<void>; onClose: () => void;
}) {
  return (
    <FormModal title={title} submitLabel={submitLabel} onClose={onClose} onSubmit={(data) => onSubmit(text(data, 'reason'))}>
      <p className="modal-text full">{intro}</p>
      <Field label="Motivo" full><input className="input" name="reason" required maxLength={300} /></Field>
    </FormModal>
  );
}
