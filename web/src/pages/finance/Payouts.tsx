import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { PayoutRow, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal } from '../../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dayLabel, money, monthKey, monthLabel, todayKey } from '../../format.ts';
import { text, useLoad } from '../../hooks.ts';

// Repasse = percentual da profissional sobre o que foi RECEBIDO no mês pelas sessões dela.
// O fechamento congela base, percentual e valor. Financeiro vê todas; a profissional, só o próprio.
export function PayoutsPage({ user }: { user: SessionUser }) {
  const notify = useToast();
  const overview = can(user, 'finance.view');
  const manage = can(user, 'finance.manage');
  const now = new Date();
  const [month, setMonth] = useState(monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
  const { data, error, reload } = useLoad(() => api.payoutStatement(month), [month]);
  const [action, setAction] = useState<{ kind: 'percent' | 'close'; row: PayoutRow } | null>(null);
  const closable = month < monthKey(now);
  const rows = data ?? [];
  const total = rows.reduce((sum, item) => sum + (item.payout ?? 0), 0);

  return (
    <>
      <Heading title={overview ? 'Repasses' : 'Meu repasse'}
        lead={overview ? 'Percentual de cada profissional sobre o valor recebido das sessões dela no mês.' : 'Seu percentual sobre o valor recebido das suas sessões no mês.'}>
        <label className="field-inline">Mês
          <input className="input compact" type="month" value={month.slice(0, 7)} required
            onChange={(event) => event.target.value && setMonth(`${event.target.value}-01`)} />
        </label>
      </Heading>

      <Panel title={`Repasses de ${monthLabel(month)}`} tools={overview && rows.length ? <span className="muted small">Total {money(total)}</span> : undefined}>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Profissional</th><th className="num">Recebido no mês</th><th className="num">Percentual</th><th className="num">Repasse</th><th>Situação</th>
                  {manage && <th><span className="sr-only">Ações</span></th>}</tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.professional_id}>
                    <td>{item.professional_name}</td>
                    <td className="num">{money(item.received)}</td>
                    <td className="num">{item.percent === null ? 'não definido' : `${item.percent.toLocaleString('pt-BR')}%`}</td>
                    <td className="num">{money(item.payout)}</td>
                    <td>{item.paid_at
                      ? <span className="st charge-paid">Pago em {dayLabel(item.paid_at)}</span>
                      : <span className="st charge-pending">{closable ? 'A fechar' : 'Mês em andamento (prévia)'}</span>}</td>
                    {manage && (
                      <td className="actions-cell">
                        <button type="button" className="link-btn" onClick={() => setAction({ kind: 'percent', row: item })}>Percentual</button>
                        {closable && !item.paid_at && item.percent !== null && (
                          <button type="button" className="link-btn" onClick={() => setAction({ kind: 'close', row: item })}>Fechar e pagar</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhum repasse neste mês." />}
      </Panel>
      <p className="muted small">Mudar o percentual vale para meses ainda não fechados. Estornos de pagamento reduzem a base enquanto o mês não é fechado.</p>

      {action?.kind === 'percent' && (
        <FormModal title={`Percentual de ${action.row.professional_name}`} submitLabel="Salvar" onClose={() => setAction(null)} onSubmit={async (form) => {
          const raw = text(form, 'percent').replace(',', '.');
          const value = raw === '' ? null : Number(raw);
          if (value !== null && (Number.isNaN(value) || value < 0 || value > 100)) throw new Error('Informe um percentual entre 0 e 100.');
          await api.setPayoutPercent(action.row.professional_id, value);
          notify('Percentual salvo.');
          reload();
        }}>
          <Field label="Repasse (% do valor recebido)">
            <input className="input" name="percent" inputMode="decimal" placeholder="Ex.: 60" defaultValue={action.row.percent ?? ''} />
          </Field>
          <p className="muted small full">Deixe em branco para remover o percentual.</p>
        </FormModal>
      )}
      {action?.kind === 'close' && (
        <FormModal title="Fechar repasse" submitLabel="Fechar e registrar pagamento" onClose={() => setAction(null)} onSubmit={async (form) => {
          await api.closePayout(action.row.professional_id, month, text(form, 'paidAt'));
          notify('Repasse fechado.');
          reload();
        }}>
          <p className="modal-text full">
            {action.row.professional_name}, {monthLabel(month)}: {money(action.row.payout)} ({action.row.percent?.toLocaleString('pt-BR')}% de {money(action.row.received)}).
            Depois de fechado, o valor não muda.
          </p>
          <Field label="Data do pagamento"><input className="input" name="paidAt" type="date" required max={todayKey()} defaultValue={todayKey()} /></Field>
        </FormModal>
      )}
    </>
  );
}
