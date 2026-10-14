import { useState } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../../shared/rules.ts';
import type { Professional, Role, SessionUser, UserAccount } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { ConfirmModal, Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { roleLabel } from '../format.ts';
import { secret, text, useLoad } from '../hooks.ts';

export function UsersPage({ user }: { user: SessionUser }) {
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UserAccount | null>(null);
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.users(), api.professionals()]), []);
  const [users, professionals] = data ?? [[], []];
  const names = new Map(professionals.map((item) => [item.id, item.name]));

  return (
    <>
      <Heading title="Usuários" lead="Contas de acesso da administração e das profissionais.">
        {/* Só com os dados atualizados: a janela usa as listas de contas e profissionais. */}
        <button type="button" className="button" disabled={loading} onClick={() => setCreating(true)}>Novo usuário</button>
      </Heading>

      <Panel title="Usuários cadastrados">
        {users.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Nome</th><th>E-mail</th><th>Função</th><th>Profissional</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.email}</td>
                    <td>{roleLabel[item.role]}</td>
                    <td>{(item.professional_id && names.get(item.professional_id)) || '—'}</td>
                    <td>{item.active ? 'Ativa' : 'Inativa'}</td>
                    <td className="actions-cell">
                      {item.id === user.id ? <span className="muted small">Você</span> : (
                        <button type="button" className="link-btn danger" disabled={loading}
                          aria-label={`Excluir ${item.name}`} onClick={() => setDeleting(item)}>Excluir</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhum usuário cadastrado." />}
      </Panel>

      {creating && (
        <UserForm users={users} professionals={professionals} onClose={() => setCreating(false)}
          onSaved={() => { notify('Usuário criado.'); reload(); }} />
      )}

      {deleting && (
        <ConfirmModal title="Excluir usuário" confirmLabel="Excluir usuário" onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.deleteUser(deleting.id);
            notify('Usuário excluído.');
            reload();
          }}>
          <p className="modal-text">
            Excluir a conta de <strong>{deleting.name}</strong> ({deleting.email})? A pessoa perde o acesso na hora.
          </p>
          <p className="modal-text muted">
            Prontuários e sessões já registrados continuam guardados. Esta ação não pode ser desfeita.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

interface UserFormProps {
  users: UserAccount[];
  professionals: Professional[];
  onClose: () => void;
  onSaved: () => void;
}

function UserForm({ users, professionals, onClose, onSaved }: UserFormProps) {
  const [role, setRole] = useState<Role>('professional');
  // Cada profissional tem no máximo uma conta.
  const available = professionals.filter((item) => item.active && !users.some((user) => user.professional_id === item.id));

  return (
    <FormModal title="Novo usuário" submitLabel="Criar usuário" onClose={onClose} onSubmit={async (data) => {
      await api.createUser({
        name: text(data, 'name'),
        email: text(data, 'email'),
        role,
        professionalId: role === 'professional' ? text(data, 'professionalId') : null,
        password: secret(data, 'password')
      });
      onSaved();
    }}>
      <Field label="Nome"><input className="input" name="name" required /></Field>
      <Field label="E-mail"><input className="input" name="email" type="email" required /></Field>
      <Field label="Função">
        <select className="input" name="role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <option value="professional">{roleLabel.professional}</option>
          <option value="admin">{roleLabel.admin}</option>
        </select>
      </Field>
      {role === 'professional' && (
        <Field label="Profissional">
          <select className="input" name="professionalId" required defaultValue="">
            <option value="" disabled>{available.length ? 'Selecione' : 'Nenhuma profissional sem conta'}</option>
            {available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      )}
      <Field label={`Senha inicial (mínimo de ${MIN_PASSWORD_LENGTH} caracteres)`} full>
        <input className="input" name="password" type="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" required />
      </Field>
    </FormModal>
  );
}
