import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Charge, Patient, Payment, Professional, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { chargeStatusLabel, dayLabel, money, monthEnd, monthKey, paymentMethodLabel, plural } from '../../format.ts';
import { useLoad } from '../../hooks.ts';
import { AdjustChargeForm, NewChargeForm, PaymentForm, ReasonForm } from './dialogs.tsx';

type View = 'abertas' | 'mes' | 'pagamentos';

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Cobranças e recebimentos. Recepção, gerência e financeiro (billing.*) veem e operam tudo;
// a profissional vê, só para consulta, as cobranças das próprias sessões.
export function ChargesPage({ user }: { user: SessionUser }) {
  const billing = can(user, 'billing.view');
  const manage = can(user, 'billing.manage');
  const [view, setView] = useState<View>('abertas');
  const [month, setMonth] = useState(monthKey(new Date()));
  const [search, setSearch] = useState('');
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((value) => value + 1);
  const lists = useLoad(() => Promise.all([
    billing ? api.patients() : Promise.resolve([] as Patient[]),
    billing ? api.professionals() : Promise.resolve([] as Professional[]),
    billing ? api.receivables() : Promise.resolve(null)
  ]), [billing, version]);
  const [patients, professionals, receivables] = lists.data ?? [[], [], null];
  const [dialog, setDialog] = useState<'payment' | 'charge' | null>(null);

  const tabs: [View, string][] = [['abertas', 'Em aberto'], ['mes', 'Por mês'], ...(billing ? [['pagamentos', 'Pagamentos'] as [View, string]] : [])];

  return (
    <>
      <Heading title="Cobranças" lead={billing ? 'Sessões cobradas, pagamentos e o que está em aberto.' : 'Cobranças das suas sessões (somente consulta).'}>
        {manage && <button type="button" className="button light" disabled={!lists.data} onClick={() => setDialog('charge')}>Nova cobrança</button>}
        {manage && <button type="button" className="button" disabled={!lists.data} onClick={() => setDialog('payment')}>Registrar pagamento</button>}
      </Heading>

      {receivables && (
        <section className="numbers" aria-label="Em aberto">
          <div className="number"><strong>{money(receivables.open_amount)}</strong><span>a receber</span></div>
          <div className="number"><strong className={receivables.overdue_amount ? 'text-danger' : undefined}>{money(receivables.overdue_amount)}</strong>
            <span>vencido em {plural(receivables.overdue_count, 'cobrança', 'cobranças')}</span></div>
        </section>
      )}

      <div className="finance-toolbar">
        <div className="tabs" role="tablist" aria-label="Visualização">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? 'tab on' : 'tab'}
              onClick={() => setView(key)}>{label}</button>
          ))}
        </div>
        {view !== 'abertas' && (
          <label className="field-inline">Mês
            <input className="input compact" type="month" value={month.slice(0, 7)} required
              onChange={(event) => event.target.value && setMonth(`${event.target.value}-01`)} />
          </label>
        )}
        <label className="search">
          <input type="search" placeholder="Buscar paciente" aria-label="Buscar paciente" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>

      {view === 'pagamentos'
        ? <PaymentsPanel month={month} search={search} manage={manage} version={version} onChanged={reload} />
        : <ChargesPanel key={view} open={view === 'abertas'} month={month} search={search} manage={manage} billing={billing}
            patients={patients} version={version} onChanged={reload} />}

      {dialog === 'payment' && <PaymentForm patients={patients} onClose={() => setDialog(null)} onSaved={reload} />}
      {dialog === 'charge' && <NewChargeForm patients={patients} professionals={professionals} onClose={() => setDialog(null)} onSaved={reload} />}
    </>
  );
}

function ChargesPanel({ open, month, search, manage, billing, patients, version, onChanged }: {
  open: boolean; month: string; search: string; manage: boolean; billing: boolean; patients: Patient[]; version: number; onChanged: () => void;
}) {
  const { data, error } = useLoad(() => (open ? api.charges(null, null, { open: true }) : api.charges(month, monthEnd(month))), [open, month, version]);
  const term = normalize(search.trim());
  const charges = (data ?? []).filter((item) => !term || normalize(item.patient_name).includes(term));
  const total = charges.filter((item) => item.status !== 'cancelled').reduce((sum, item) => sum + item.balance, 0);

  return (
    <Panel title={open ? 'Cobranças em aberto' : 'Cobranças do mês (competência)'}
      tools={charges.length ? <span className="muted small">{plural(charges.length, 'cobrança', 'cobranças')} · em aberto {money(total)}</span> : undefined}>
      {charges.length
        ? <ChargesTable charges={charges} manage={manage} showPatient showProfessional={billing} patients={patients} onChanged={onChanged} />
        : <PanelState error={error} loading={!data} empty={open ? 'Nenhuma cobrança em aberto.' : 'Nenhuma cobrança neste mês.'} />}
    </Panel>
  );
}

// Tabela de cobranças com as ações de recepção/financeiro (usada também na página do paciente).
export function ChargesTable({ charges, manage, showPatient, showProfessional, patients, onChanged }: {
  charges: Charge[]; manage: boolean; showPatient: boolean; showProfessional: boolean; patients: Patient[]; onChanged: () => void;
}) {
  const notify = useToast();
  const [action, setAction] = useState<{ kind: 'pay' | 'adjust' | 'cancel'; charge: Charge } | null>(null);
  const [busy, setBusy] = useState('');

  async function spendCredit(charge: Charge) {
    setBusy(charge.id);
    try {
      const applied = await api.applyCredit(charge.id);
      notify(applied > 0 ? `${money(applied)} de crédito abatidos.` : 'O paciente não tem crédito disponível.');
      onChanged();
    } catch (failure) {
      notify(failure instanceof Error ? failure.message : 'Não foi possível usar o crédito.');
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {showPatient && <th>Paciente</th>}<th>Descrição</th>{showProfessional && <th>Profissional</th>}
              <th>Vencimento</th><th className="num">Valor</th><th className="num">Recebido</th><th className="num">Em aberto</th><th>Situação</th>
              {manage && <th><span className="sr-only">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {charges.map((item) => {
              const active = item.status !== 'cancelled';
              return (
                <tr key={item.id}>
                  {showPatient && <td><a href={`#/pacientes?id=${item.patient_id}&aba=financeiro`}>{item.patient_name}</a></td>}
                  <td>{item.description}{item.cancellation_reason && <span className="sub">Cancelada: {item.cancellation_reason}</span>}</td>
                  {showProfessional && <td>{item.professional_name ?? '—'}</td>}
                  <td className="num-left">{dayLabel(item.due_date)}</td>
                  <td className="num">{money(item.amount - item.discount)}{item.discount > 0 && <span className="sub">desconto {money(item.discount)}</span>}</td>
                  <td className="num">{money(item.paid)}</td>
                  <td className="num">{active ? money(item.balance) : '—'}</td>
                  <td><span className={`st charge-${item.status}`}>{chargeStatusLabel[item.status]}</span></td>
                  {manage && (
                    <td className="actions-cell">
                      {active && item.balance > 0 && <>
                        <button type="button" className="link-btn" onClick={() => setAction({ kind: 'pay', charge: item })}>Receber</button>
                        <button type="button" className="link-btn" disabled={busy === item.id} onClick={() => spendCredit(item)}>Usar crédito</button>
                      </>}
                      {active && <button type="button" className="link-btn" onClick={() => setAction({ kind: 'adjust', charge: item })}>{item.status === 'unpriced' ? 'Definir valor' : 'Ajustar'}</button>}
                      {active && <button type="button" className="link-btn danger" onClick={() => setAction({ kind: 'cancel', charge: item })}>Cancelar</button>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {action?.kind === 'pay' && (
        <PaymentForm patients={patients.length ? patients : [{ id: action.charge.patient_id, name: action.charge.patient_name } as Patient]}
          patientId={action.charge.patient_id} chargeId={action.charge.id} onClose={() => setAction(null)} onSaved={onChanged} />
      )}
      {action?.kind === 'adjust' && <AdjustChargeForm charge={action.charge} onClose={() => setAction(null)} onSaved={onChanged} />}
      {action?.kind === 'cancel' && (
        <ReasonForm title="Cancelar cobrança" submitLabel="Cancelar cobrança" onClose={() => setAction(null)}
          intro={`${action.charge.description} · ${action.charge.patient_name}. O que já foi recebido volta a ser crédito do paciente.`}
          onSubmit={async (reason) => { await api.cancelCharge(action.charge.id, reason); notify('Cobrança cancelada.'); onChanged(); }} />
      )}
    </>
  );
}

function PaymentsPanel({ month, search, manage, version, onChanged }: {
  month: string; search: string; manage: boolean; version: number; onChanged: () => void;
}) {
  const { data, error } = useLoad(() => api.payments(month, monthEnd(month)), [month, version]);
  const term = normalize(search.trim());
  const payments = (data ?? []).filter((item) => !term || normalize(item.patient_name).includes(term));
  const total = payments.filter((item) => !item.reversed_at).reduce((sum, item) => sum + item.amount, 0);
  return (
    <Panel title="Pagamentos recebidos no mês" tools={payments.length ? <span className="muted small">Total {money(total)}</span> : undefined}>
      {payments.length ? <PaymentsTable payments={payments} manage={manage} showPatient onChanged={onChanged} />
        : <PanelState error={error} loading={!data} empty="Nenhum pagamento neste mês." />}
    </Panel>
  );
}

export function PaymentsTable({ payments, manage, showPatient, onChanged }: {
  payments: Payment[]; manage: boolean; showPatient: boolean; onChanged: () => void;
}) {
  const notify = useToast();
  const [reversing, setReversing] = useState<Payment | null>(null);
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Data</th>{showPatient && <th>Paciente</th>}<th>Forma</th><th className="num">Valor</th><th className="num">Em cobranças</th>
              <th className="num">Crédito</th><th>Situação</th>{manage && <th><span className="sr-only">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {payments.map((item) => (
              <tr key={item.id}>
                <td className="num-left">{dayLabel(item.received_at)}</td>
                {showPatient && <td><a href={`#/pacientes?id=${item.patient_id}&aba=financeiro`}>{item.patient_name}</a></td>}
                <td>{paymentMethodLabel[item.method]}{item.notes && <span className="sub">{item.notes}</span>}</td>
                <td className="num">{money(item.amount)}</td>
                <td className="num">{item.reversed_at ? '—' : money(item.allocated)}</td>
                <td className="num">{item.reversed_at ? '—' : money(item.amount - item.allocated)}</td>
                <td>{item.reversed_at
                  ? <span className="st charge-cancelled">Estornado<span className="sub">{item.reversal_reason}</span></span>
                  : <span className="st charge-paid">Recebido</span>}</td>
                {manage && (
                  <td className="actions-cell">
                    {!item.reversed_at && <button type="button" className="link-btn danger" onClick={() => setReversing(item)}>Estornar</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {reversing && (
        <ReasonForm title="Estornar pagamento" submitLabel="Estornar" onClose={() => setReversing(null)}
          intro={`${money(reversing.amount)} de ${reversing.patient_name} em ${dayLabel(reversing.received_at)}. As cobranças quitadas por ele voltam a ficar em aberto.`}
          onSubmit={async (reason) => { await api.reversePayment(reversing.id, reason); notify('Pagamento estornado.'); onChanged(); }} />
      )}
    </>
  );
}
