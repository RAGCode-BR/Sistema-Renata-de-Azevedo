import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFormSubmit } from '../hooks.ts';

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

export function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return (
    <label className={full ? 'field full' : 'field'}>
      <span>{label}</span>
      {children}
    </label>
  );
}
