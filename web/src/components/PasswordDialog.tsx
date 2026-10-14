import { MIN_PASSWORD_LENGTH } from '../../../shared/rules.ts';
import { api } from '../api.ts';
import { secret } from '../hooks.ts';
import { Field, FormModal } from './Modal.tsx';
import { useToast } from './Toast.tsx';

export function PasswordDialog({ onClose }: { onClose: () => void }) {
  const notify = useToast();

  return (
    <FormModal title="Trocar senha" submitLabel="Salvar senha" onClose={onClose} onSubmit={async (data) => {
      await api.changePassword(secret(data, 'currentPassword'), secret(data, 'newPassword'));
      notify('Senha alterada.');
    }}>
      <Field label="Senha atual" full>
        <input className="input" name="currentPassword" type="password" autoComplete="current-password" required />
      </Field>
      <Field label={`Nova senha (mínimo de ${MIN_PASSWORD_LENGTH} caracteres)`} full>
        <input className="input" name="newPassword" type="password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
      </Field>
    </FormModal>
  );
}
