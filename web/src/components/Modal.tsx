import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { errorMessage, useFormSubmit } from '../hooks.ts';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

// Abre ao ser montada; quem a usa a desmonta em `onClose`.
export function Modal({ title, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onClose={onClose}>
      <div className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="modal-close" onClick={onClose}>Fechar</button>
      </div>
      {children}
    </dialog>
  );
}

interface FormModalProps extends ModalProps {
  submitLabel: string;
  onSubmit: (data: FormData) => Promise<void>;
}

export function FormModal({ title, submitLabel, onClose, onSubmit, children }: FormModalProps) {
  const { busy, error, onSubmit: handleSubmit } = useFormSubmit(async (data) => {
    await onSubmit(data);
    onClose();
  });

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="modal-body form-grid">{children}</div>
        {error && <p className="erro modal-error" role="alert">{error}</p>}
        <div className="modal-foot">
          <button type="button" className="button light" onClick={onClose}>Cancelar</button>
          <button type="submit" className="button" disabled={busy}>{busy ? 'Salvando…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

interface ConfirmModalProps extends ModalProps {
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

// Confirmação de ação destrutiva: botão vermelho, erro mostrado na própria janela.
export function ConfirmModal({ title, confirmLabel, onClose, onConfirm, children }: ConfirmModalProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body">{children}</div>
      {error && <p className="erro modal-error" role="alert">{error}</p>}
      <div className="modal-foot">
        <button type="button" className="button light" onClick={onClose}>Cancelar</button>
        <button type="button" className="button danger" disabled={busy} onClick={confirm}>{busy ? 'Excluindo…' : confirmLabel}</button>
      </div>
    </Modal>
  );
}

export function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return (
    <label className={full ? 'field full' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}

// Ícone de pessoa no lugar da foto ainda não escolhida (cadastros de paciente e de profissional).
export const PERSON_ICON = (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
    <circle cx="12" cy="8.5" r="3.6" /><path d="M5 19.5c1.3-3.3 3.9-5 7-5s5.7 1.7 7 5" />
  </svg>
);
