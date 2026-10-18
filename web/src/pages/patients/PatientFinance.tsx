import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Patient, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal } from '../../components/Modal.tsx';
import { Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { money, parseMoney } from '../../format.ts';
import { text, useLoad } from '../../hooks.ts';
import { ChargesTable, PaymentsTable } from '../finance/Charges.tsx';
import { PaymentForm } from '../finance/dialogs.tsx';

// Aba Financeiro do paciente: saldo, crédito, valor combinado, cobranças e pagamentos.
// A profissional vê só as cobranças das próprias sessões (sem pagamentos, crédito ou valor combinado).
export function PatientFinance({ user, patient }: { user: SessionUser; patient: Patient }) {
  const notify = useToast();
  const billing = can(user, 'billing.view');
  const manage = can(user, 'billing.manage');
  const { data, error, reload } = useLoad(() => Promise.all([
    api.charges('2000-01-01', '2100-12-31', { patientId: patient.id }),
    billing ? api.payments(null, null, patient.id) : Promise.resolve([]),
    billing ? api.patientCredit(patient.id) : Promise.resolve(0),
    billing ? api.patientPrice(patient.id) : Promise.resolve(null)
  ]), [patient.id, billing]);
  const [dialog, setDialog] = useState<'payment' | 'price' | null>(null);

  if (!data) return <PanelState error={error} loading={!error} empty="" />;
  const [charges, payments, credit, price] = data;
  const open = charges.filter((item) => item.status !== 'cancelled').reduce((sum, item) => sum + item.balance, 0);
  const overdue = charges.filter((item) => item.status === 'overdue').reduce((sum, item) => sum + item.balance, 0);

  return (
    <>
      <section className="numbers" aria-label="Situação financeira">
        <div className="number"><strong>{money(open)}</strong><span>em aberto</span></div>
        <div className="number"><strong className={overdue ? 'text-danger' : undefined}>{money(overdue)}</strong><span>vencido</span></div>
        {billing && <div className="number"><strong>{money(credit)}</strong><span>crédito disponível</span></div>}
        {billing && (
          <div className="number">
            <strong>{price === null ? 'Tabela' : money(price)}</strong>
            <span>valor da sessão{price === null ? ' (preço da tabela)' : ' combinado'}</span>
            {can(user, 'finance.manage') && <button type="button" className="link-btn" onClick={() => setDialog('price')}>Alterar</button>}
          </div>
        )}
      </section>

      <Panel title="Cobranças" tools={manage ? <button type="button" className="button" onClick={() => setDialog('payment')}>Registrar pagamento</button> : undefined}>
        {charges.length
          ? <ChargesTable charges={charges} manage={manage} showPatient={false} showProfessional patients={[patient]} onChanged={reload} />
          : <p className="empty-state">Nenhuma cobrança.</p>}
      </Panel>

      {billing && (
        <Panel title="Pagamentos">
          {payments.length ? <PaymentsTable payments={payments} manage={manage} showPatient={false} onChanged={reload} />
            : <p className="empty-state">Nenhum pagamento registrado.</p>}
        </Panel>
      )}

      {dialog === 'payment' && <PaymentForm patients={[patient]} patientId={patient.id} onClose={() => setDialog(null)} onSaved={reload} />}
      {dialog === 'price' && (
        <FormModal title="Valor combinado da sessão" submitLabel="Salvar" onClose={() => setDialog(null)} onSubmit={async (form) => {
          const raw = text(form, 'amount');
          const value = raw ? parseMoney(raw) : null;
          if (value !== null && (Number.isNaN(value) || value < 0)) throw new Error('Informe um valor válido (ex.: 200,00).');
          await api.setPatientPrice(patient.id, value);
          notify('Valor combinado salvo.');
          reload();
        }}>
          <Field label="Valor por sessão">
            <input className="input" name="amount" inputMode="decimal" placeholder="Em branco = usar a tabela" defaultValue={price === null ? '' : String(price).replace('.', ',')} />
          </Field>
          <p className="muted small full">Vale para as próximas cobranças deste paciente, com qualquer profissional.</p>
        </FormModal>
      )}
    </>
  );
}
