import { Select } from '../../components/Select.tsx';
import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { SessionPrice, SessionType, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { ConfirmModal, Field, FormModal } from '../../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { money, sessionTypeLabel } from '../../format.ts';
import { text, useLoad } from '../../hooks.ts';
import { readMoney } from './dialogs.tsx';

// Tabela de preços. Na hora de cobrar vale, nesta ordem: valor combinado com o paciente →
// profissional + tipo → profissional → tipo → padrão da clínica. Sem preço, a cobrança fica "valor a definir".
export function PricesPage({ user }: { user: SessionUser }) {
  const notify = useToast();
  const manage = can(user, 'finance.manage');
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.sessionPrices(), api.professionals()]), []);
  const [prices, professionals] = data ?? [[], []];
  const [editing, setEditing] = useState<SessionPrice | 'new' | null>(null);
  const [removing, setRemoving] = useState<SessionPrice | null>(null);
  const names = new Map(professionals.map((item) => [item.id, item.name]));
  const scope = (price: SessionPrice) => price.professional_id ? names.get(price.professional_id) ?? '—' : 'Todas (padrão da clínica)';
  const sorted = [...prices].sort((a, b) => Number(Boolean(a.professional_id)) - Number(Boolean(b.professional_id))
    || scope(a).localeCompare(scope(b)) || Number(Boolean(a.session_type)) - Number(Boolean(b.session_type)));

  return (
    <>
      <Heading title="Preços" lead="Valor da sessão usado nas cobranças automáticas.">
        {manage && <button type="button" className="button" disabled={loading} onClick={() => setEditing('new')}>Novo preço</button>}
      </Heading>

      <Panel title="Tabela de preços">
        {sorted.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Profissional</th><th>Tipo de sessão</th><th className="num">Valor</th>{manage && <th><span className="sr-only">Ações</span></th>}</tr></thead>
              <tbody>
                {sorted.map((item) => (
                  <tr key={item.id}>
                    <td>{scope(item)}</td>
                    <td>{item.session_type ? sessionTypeLabel[item.session_type] : 'Qualquer tipo'}</td>
                    <td className="num">{money(item.amount)}</td>
                    {manage && (
                      <td className="actions-cell">
                        <button type="button" className="link-btn" onClick={() => setEditing(item)}>Alterar valor</button>
                        <button type="button" className="link-btn danger" onClick={() => setRemoving(item)}>Remover</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhum preço cadastrado. Sem preço, as sessões geram cobrança com valor a definir." />}
      </Panel>
      <p className="muted small">O valor combinado com um paciente específico fica na aba Financeiro da página do paciente e tem prioridade sobre esta tabela. Mudanças de preço valem para as próximas cobranças.</p>

      {editing && (
        <FormModal title={editing === 'new' ? 'Novo preço' : 'Alterar valor'} submitLabel="Salvar" onClose={() => setEditing(null)} onSubmit={async (form) => {
          const amount = readMoney(form, 'amount', 'Valor', { allowZero: true });
          if (editing === 'new') {
            await api.saveSessionPrice({ id: null, professionalId: text(form, 'professional') || null, sessionType: text(form, 'type') || null, amount });
          } else {
            await api.saveSessionPrice({ id: editing.id, professionalId: editing.professional_id, sessionType: editing.session_type, amount });
          }
          notify('Preço salvo.');
          reload();
        }}>
          {editing === 'new' ? <>
            <Field label="Profissional">
              <Select className="input" name="professional" defaultValue="">
                <option value="">Todas (padrão da clínica)</option>
                {professionals.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
            <Field label="Tipo de sessão">
              <Select className="input" name="type" defaultValue="">
                <option value="">Qualquer tipo</option>
                {(Object.keys(sessionTypeLabel) as SessionType[]).map((type) => <option key={type} value={type}>{sessionTypeLabel[type]}</option>)}
              </Select>
            </Field>
          </> : <p className="modal-text full">{scope(editing)} · {editing.session_type ? sessionTypeLabel[editing.session_type] : 'Qualquer tipo'}</p>}
          <Field label="Valor da sessão">
            <input className="input" name="amount" inputMode="decimal" required placeholder="250,00"
              defaultValue={editing === 'new' ? '' : String(editing.amount).replace('.', ',')} />
          </Field>
        </FormModal>
      )}
      {removing && (
        <ConfirmModal title="Remover preço" confirmLabel="Remover" onClose={() => setRemoving(null)}
          onConfirm={async () => { await api.deleteSessionPrice(removing.id); notify('Preço removido.'); reload(); }}>
          <p className="modal-text">{scope(removing)} · {removing.session_type ? sessionTypeLabel[removing.session_type] : 'Qualquer tipo'}: {money(removing.amount)}. Cobranças já criadas não mudam.</p>
        </ConfirmModal>
      )}
    </>
  );
}
