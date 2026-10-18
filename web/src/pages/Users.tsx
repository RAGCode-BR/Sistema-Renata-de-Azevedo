import { useState } from 'react';
import { roleDescription, roleLabel, STAFF_ROLES } from '../../../shared/permissions.ts';
import { MIN_PASSWORD_LENGTH } from '../../../shared/rules.ts';
import type { Professional, Role, SessionUser, UserAccount } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { ConfirmModal, Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { secret, text, useLoad } from '../hooks.ts';

export function UsersPage({ user }: { user: SessionUser }) {
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [deleting, setDeleting] = useState<UserAccount | null>(null);
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.users(), api.professionals()]), []);
  const [users, professionals] = data ?? [[], []];
  const names = new Map(professionals.map((item) => [item.id, item.name]));

  return (
    <>
      <Heading title="Usuários" lead="Contas de acesso da equipe. Uma pessoa pode ter mais de um perfil.">
        {/* Só com os dados atualizados: a janela usa as listas de contas e profissionais. */}
        <button type="button" className="button" disabled={loading} onClick={() => setCreating(true)}>Novo usuário</button>
      </Heading>

      <Panel title="Usuários cadastrados">
        {users.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Nome</th><th>E-mail</th><th>Perfis</th><th>Profissional</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}{item.id === user.id && <span className="sub">Você</span>}</td>
                    <td>{item.email}</td>
                    <td>{item.roles.map((role) => roleLabel[role]).join(' · ') || '—'}</td>
                    <td>{(item.professional_id && names.get(item.professional_id)) || '—'}</td>
                    <td>{item.active ? 'Ativa' : 'Inativa'}</td>
                    <td className="actions-cell">
                      <button type="button" className="link-btn" disabled={loading}
                        aria-label={`Editar ${item.name}`} onClick={() => setEditing(item)}>Editar</button>
                      {item.id !== user.id && (
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
        <UserForm users={users} professionals={professionals} self={user} onClose={() => setCreating(false)}
          onSaved={() => { notify('Usuário criado.'); reload(); }} />
      )}

      {editing && (
        <UserForm account={editing} users={users} professionals={professionals} self={user} onClose={() => setEditing(null)}
          onSaved={() => { notify('Usuário atualizado.'); reload(); }} />
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
            Para suspender o acesso sem excluir, use Editar e desmarque &ldquo;Conta ativa&rdquo;.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

interface UserFormProps {
  // Sem `account`: criação. Com `account`: edição de perfis, profissional e situação.
  account?: UserAccount;
  users: UserAccount[];
  professionals: Professional[];
  self: SessionUser;
  onClose: () => void;
  onSaved: () => void;
}

function UserForm({ account, users, professionals, self, onClose, onSaved }: UserFormProps) {
  const [roles, setRoles] = useState<Role[]>(account?.roles ?? ['professional']);
  const isSelf = account?.id === self.id;
  // O banco também impede: ninguém tira de si o perfil de Proprietário(a) nem se desativa.
  const lockedOwner = isSelf && account.roles.includes('owner');
  // Cada profissional tem no máximo uma conta (a desta conta continua disponível na edição).
  const available = professionals.filter((item) => item.active
    && (item.id === account?.professional_id || !users.some((other) => other.professional_id === item.id)));
  const professional = roles.includes('professional');

  function toggle(role: Role, checked: boolean) {
    setRoles((current) => checked ? [...current, role] : current.filter((item) => item !== role));
  }

  return (
    <FormModal title={account ? `Editar ${account.name}` : 'Novo usuário'} submitLabel={account ? 'Salvar' : 'Criar usuário'}
      onClose={onClose} onSubmit={async (data) => {
        if (!roles.length) throw new Error('Escolha ao menos um perfil.');
        const professionalId = professional ? text(data, 'professionalId') || null : null;
        if (account) {
          await api.updateUserAccess({ userId: account.id, roles, professionalId, active: isSelf || data.get('active') === 'on' });
        } else {
          await api.createUser({ name: text(data, 'name'), email: text(data, 'email'), roles, professionalId, password: secret(data, 'password') });
        }
        onSaved();
      }}>
      {!account && <Field label="Nome"><input className="input" name="name" required /></Field>}
      {!account && <Field label="E-mail"><input className="input" name="email" type="email" required /></Field>}

      <fieldset className="full checks role-checks">
        <legend>Perfis</legend>
        {STAFF_ROLES.map((role) => (
          <label key={role} className="check">
            <input type="checkbox" name="roles" value={role} checked={roles.includes(role)}
              disabled={role === 'owner' && lockedOwner} onChange={(event) => toggle(role, event.target.checked)} />
            <span>{roleLabel[role]}<span className="sub">{roleDescription[role]}</span></span>
          </label>
        ))}
      </fieldset>

      {professional && (
        <Field label="Profissional vinculada" full>
          <select className="input" name="professionalId" required defaultValue={account?.professional_id ?? ''}>
            <option value="" disabled>{available.length ? 'Selecione' : 'Nenhuma profissional sem conta'}</option>
            {available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      )}

      {account ? (
        <label className="check full">
          <input type="checkbox" name="active" defaultChecked={account.active} disabled={isSelf} />
          Conta ativa{isSelf && <span className="muted small">(você não pode desativar a própria conta)</span>}
        </label>
      ) : (
        <Field label={`Senha inicial (mínimo de ${MIN_PASSWORD_LENGTH} caracteres)`} full>
          <input className="input" name="password" type="password" minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" required />
        </Field>
      )}
    </FormModal>
  );
}
