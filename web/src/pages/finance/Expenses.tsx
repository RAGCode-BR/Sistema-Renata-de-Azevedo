import { Select } from '../../components/Select.tsx';
import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Expense, NamedItem, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { ConfirmModal, Field, FormModal } from '../../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dayLabel, money, monthEnd, monthKey, paymentMethodLabel, plural, todayKey } from '../../format.ts';
import { text, useLoad } from '../../hooks.ts';
import { readMoney } from './dialogs.tsx';

const EXPENSE_METHODS = ['pix', 'boleto', 'transfer', 'debit', 'credit', 'cash'] as const;
type NamedTable = 'cost_centers' | 'finance_categories';

// Despesas (finance.view para ver, finance.manage para lançar). O mês filtra pelo vencimento.
export function ExpensesPage({ user }: { user: SessionUser }) {
  const notify = useToast();
  const manage = can(user, 'finance.manage');
  const [month, setMonth] = useState(monthKey(new Date()));
  const { data, error, loading, reload } = useLoad(() => Promise.all([
    api.expenses(month, monthEnd(month)), api.financeCategories(), api.costCenters()
  ]), [month]);
  const [expenses, categories, centers] = data ?? [[], [], []];
  const [editing, setEditing] = useState<Expense | 'new' | null>(null);
  const [removing, setRemoving] = useState<Expense | null>(null);
  const [lists, setLists] = useState<NamedTable | null>(null);
  const names = new Map([...categories, ...centers].map((item) => [item.id, item.name]));
  const today = todayKey();
  const paid = expenses.filter((item) => item.paid_at).reduce((sum, item) => sum + item.amount, 0);
  const open = expenses.filter((item) => !item.paid_at).reduce((sum, item) => sum + item.amount, 0);

  return (
    <>
      <Heading title="Despesas" lead="Contas da clínica por categoria e centro de custo.">
        <label className="field-inline">Vencimento em
          <input className="input compact" type="month" value={month.slice(0, 7)} required
            onChange={(event) => event.target.value && setMonth(`${event.target.value}-01`)} />
        </label>
        {manage && <button type="button" className="button" disabled={loading} onClick={() => setEditing('new')}>Nova despesa</button>}
      </Heading>

      <section className="numbers" aria-label="Resumo do mês">
        <div className="number"><strong>{money(paid)}</strong><span>pagas</span></div>
        <div className="number"><strong>{money(open)}</strong><span>a pagar</span></div>
      </section>

      <Panel title="Despesas do mês" tools={expenses.length ? <span className="muted small">{plural(expenses.length, 'despesa', 'despesas')}</span> : undefined}>
        {expenses.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Centro de custo</th><th className="num">Valor</th><th>Situação</th>
                  {manage && <th><span className="sr-only">Ações</span></th>}</tr>
              </thead>
              <tbody>
                {expenses.map((item) => (
                  <tr key={item.id}>
                    <td className="num-left">{dayLabel(item.due_date)}</td>
                    <td>{item.description}{item.supplier && <span className="sub">{item.supplier}</span>}</td>
                    <td>{names.get(item.category_id) ?? '—'}</td>
                    <td>{names.get(item.cost_center_id) ?? '—'}</td>
                    <td className="num">{money(item.amount)}</td>
                    <td>{item.paid_at
                      ? <span className="st charge-paid">Paga em {dayLabel(item.paid_at)}{item.method && <span className="sub">{paymentMethodLabel[item.method]}</span>}</span>
                      : <span className={item.due_date < today ? 'st charge-overdue' : 'st charge-pending'}>{item.due_date < today ? 'Vencida' : 'A pagar'}</span>}</td>
                    {manage && (
                      <td className="actions-cell">
                        <button type="button" className="link-btn" onClick={() => setEditing(item)}>Editar</button>
                        <button type="button" className="link-btn danger" onClick={() => setRemoving(item)}>Excluir</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhuma despesa com vencimento neste mês." />}
      </Panel>

      {manage && (
        <p className="muted small">
          Listas: <button type="button" className="link-btn" onClick={() => setLists('finance_categories')}>categorias</button> ·{' '}
          <button type="button" className="link-btn" onClick={() => setLists('cost_centers')}>centros de custo</button>
        </p>
      )}

      {editing && (
        <ExpenseForm expense={editing === 'new' ? null : editing} categories={categories} centers={centers}
          onClose={() => setEditing(null)} onSaved={(message) => { notify(message); reload(); }} />
      )}
      {removing && (
        <ConfirmModal title="Excluir despesa" confirmLabel="Excluir" onClose={() => setRemoving(null)}
          onConfirm={async () => { await api.deleteExpense(removing.id); notify('Despesa excluída.'); reload(); }}>
          <p className="modal-text">{removing.description}, {money(removing.amount)}, vencimento {dayLabel(removing.due_date)}. A exclusão fica registrada na auditoria.</p>
        </ConfirmModal>
      )}
      {lists && (
        <NamedItemsDialog table={lists} items={lists === 'cost_centers' ? centers : categories}
          onClose={() => setLists(null)} onChanged={reload} />
      )}
    </>
  );
}

function ExpenseForm({ expense, categories, centers, onClose, onSaved }: {
  expense: Expense | null; categories: NamedItem[]; centers: NamedItem[]; onClose: () => void; onSaved: (message: string) => void;
}) {
  const [isPaid, setIsPaid] = useState(Boolean(expense?.paid_at));
  const usable = (items: NamedItem[], current?: string) => items.filter((item) => item.active || item.id === current);
  return (
    <FormModal title={expense ? 'Editar despesa' : 'Nova despesa'} submitLabel={expense ? 'Salvar' : 'Lançar despesa'} onClose={onClose}
      onSubmit={async (data) => {
        const input: Omit<Expense, 'id'> = {
          description: text(data, 'description'), supplier: text(data, 'supplier') || null,
          category_id: text(data, 'category'), cost_center_id: text(data, 'center'), amount: readMoney(data, 'amount', 'Valor'),
          competence_date: text(data, 'competence'), due_date: text(data, 'due'),
          paid_at: isPaid ? text(data, 'paidAt') : null, method: isPaid ? text(data, 'method') as Expense['method'] : null,
          notes: text(data, 'notes') || null
        };
        await api.saveExpense(expense?.id ?? null, input);
        onSaved(expense ? 'Despesa atualizada.' : 'Despesa lançada.');
      }}>
      <Field label="Descrição" full><input className="input" name="description" required maxLength={200} defaultValue={expense?.description} /></Field>
      <Field label="Fornecedor (opcional)"><input className="input" name="supplier" maxLength={120} defaultValue={expense?.supplier ?? ''} /></Field>
      <Field label="Valor"><input className="input" name="amount" inputMode="decimal" required placeholder="0,00"
        defaultValue={expense ? String(expense.amount).replace('.', ',') : ''} /></Field>
      <Field label="Categoria">
        <Select className="input" name="category" required defaultValue={expense?.category_id ?? ''}>
          <option value="" disabled>Escolha</option>
          {usable(categories, expense?.category_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      <Field label="Centro de custo">
        <Select className="input" name="center" required defaultValue={expense?.cost_center_id ?? ''}>
          <option value="" disabled>Escolha</option>
          {usable(centers, expense?.cost_center_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      <Field label="Competência (mês a que se refere)"><input className="input" name="competence" type="date" required defaultValue={expense?.competence_date ?? todayKey()} /></Field>
      <Field label="Vencimento"><input className="input" name="due" type="date" required defaultValue={expense?.due_date ?? todayKey()} /></Field>
      <label className="check full">
        <input type="checkbox" checked={isPaid} onChange={(event) => setIsPaid(event.target.checked)} />
        <span>Já foi paga</span>
      </label>
      {isPaid && <>
        <Field label="Data do pagamento"><input className="input" name="paidAt" type="date" required max={todayKey()} defaultValue={expense?.paid_at ?? todayKey()} /></Field>
        <Field label="Forma de pagamento">
          <Select className="input" name="method" defaultValue={expense?.method ?? 'pix'}>
            {EXPENSE_METHODS.map((method) => <option key={method} value={method}>{paymentMethodLabel[method]}</option>)}
          </Select>
        </Field>
      </>}
      <Field label="Observação (opcional)" full><input className="input" name="notes" maxLength={300} defaultValue={expense?.notes ?? ''} /></Field>
    </FormModal>
  );
}

// Categorias e centros de custo: adicionar, renomear e desativar (itens usados não são apagados).
function NamedItemsDialog({ table, items, onClose, onChanged }: { table: NamedTable; items: NamedItem[]; onClose: () => void; onChanged: () => void }) {
  const notify = useToast();
  const title = table === 'cost_centers' ? 'Centros de custo' : 'Categorias de despesa';
  return (
    <FormModal title={title} submitLabel="Salvar" onClose={onClose} onSubmit={async (data) => {
      for (const item of items) {
        const name = text(data, `name-${item.id}`);
        const active = data.get(`active-${item.id}`) === 'on';
        if (name !== item.name || active !== item.active) await api.saveNamedItem(table, { id: item.id, name, active });
      }
      const added = text(data, 'new');
      if (added) await api.saveNamedItem(table, { id: null, name: added, active: true });
      notify(`${title} salvos.`);
      onChanged();
    }}>
      {items.map((item) => (
        <div key={item.id} className="named-row full">
          <input className="input" name={`name-${item.id}`} required defaultValue={item.name} aria-label={`Nome de ${item.name}`} />
          <label className="check"><input type="checkbox" name={`active-${item.id}`} defaultChecked={item.active} /><span>Ativo</span></label>
        </div>
      ))}
      <Field label="Adicionar" full><input className="input" name="new" maxLength={80} placeholder="Novo nome (opcional)" /></Field>
    </FormModal>
  );
}
