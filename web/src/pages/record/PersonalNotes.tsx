import { useState } from 'react';
import type { ClinicalNote } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { ConfirmModal, Field, FormModal } from '../../components/Modal.tsx';
import { Panel } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dateTime } from '../../format.ts';
import { text, useFormSubmit } from '../../hooks.ts';

// Anotações pessoais da profissional: fora do prontuário formal (não entram na exportação) e
// editáveis. Continuam sendo dados sensíveis guardados no sistema, visíveis só para ela.
export function PersonalNotes({ patientId, notes, onChanged }: { patientId: string; notes: ClinicalNote[]; onChanged: () => void }) {
  const notify = useToast();
  const [editing, setEditing] = useState<ClinicalNote | null>(null);
  const [deleting, setDeleting] = useState<ClinicalNote | null>(null);
  const { busy, error, onSubmit } = useFormSubmit(async (form) => {
    await api.saveClinicalNote({ id: null, patientId, appointmentId: null, kind: 'personal', body: text(form, 'body') });
    notify('Anotação salva.');
    onChanged();
  });

  return (
    <>
      <p className="notice">Anotações pessoais ficam fora do prontuário formal e não entram na exportação. Só você as vê.</p>
      <Panel title="Nova anotação pessoal">
        <form className="panel-body stack" onSubmit={onSubmit}>
          <label className="field"><span>Anotação</span><textarea className="input" name="body" rows={4} required /></label>
          {error && <p className="erro" role="alert">{error}</p>}
          <button type="submit" className="button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar anotação'}</button>
        </form>
      </Panel>
      <Panel title="Anotações pessoais">
        {notes.length ? notes.map((note) => (
          <article key={note.id} className="entry">
            <div className="entry-head"><strong>{dateTime(note.updated_at)}</strong></div>
            <p>{note.body}</p>
            <div className="entry-actions">
              <button type="button" className="link-btn" onClick={() => setEditing(note)}>Editar</button>
              <button type="button" className="link-btn danger" onClick={() => setDeleting(note)}>Excluir</button>
            </div>
          </article>
        )) : <p className="empty-state">Nenhuma anotação pessoal.</p>}
      </Panel>

      {editing && (
        <FormModal title="Editar anotação" submitLabel="Salvar" onClose={() => setEditing(null)} onSubmit={async (data) => {
          await api.saveClinicalNote({ id: editing.id, patientId, appointmentId: null, kind: 'personal', body: text(data, 'body') });
          notify('Anotação salva.');
          onChanged();
        }}>
          <Field label="Anotação" full><textarea className="input" name="body" rows={6} required defaultValue={editing.body} /></Field>
        </FormModal>
      )}
      {deleting && (
        <ConfirmModal title="Excluir anotação" confirmLabel="Excluir" onClose={() => setDeleting(null)} onConfirm={async () => {
          await api.deleteClinicalNote(deleting.id);
          notify('Anotação excluída.');
          onChanged();
        }}>
          <p className="modal-text">A anotação pessoal será apagada.</p>
        </ConfirmModal>
      )}
    </>
  );
}
