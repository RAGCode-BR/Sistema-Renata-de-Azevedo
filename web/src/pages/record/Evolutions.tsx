import { useState } from 'react';
import type { ClinicalNote, PendingNote } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { ConfirmModal, Field, FormModal, Modal } from '../../components/Modal.tsx';
import { Panel } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dateTime, longDay, relativeDay, time } from '../../format.ts';
import { errorMessage, text, useLoad } from '../../hooks.ts';

interface EvolutionsProps {
  patientId: string;
  notes: ClinicalNote[];
  pending: PendingNote[];
  appointmentId: string | null;
  // Evoluções que nasceram de um rascunho de IA (origem do conteúdo).
  aiNotes?: Set<string>;
  onChanged: () => void;
}

interface Draft { id: string | null; appointmentId: string; body: string }

const sessionLabel = (startsAt: string) => `${relativeDay(startsAt)} às ${time(startsAt)}`;

// Evoluções: rascunho (editável, cada salvamento guarda a versão anterior) → finalizada (imutável).
// Uma evolução finalizada só é corrigida por retificação, que fica ligada a ela.
export function Evolutions({ patientId, notes, pending, appointmentId, aiNotes, onChanged }: EvolutionsProps) {
  const notify = useToast();
  const draftFor = (session: string) => notes.find((note) => note.status === 'draft' && note.appointment_id === session);
  const [draft, setDraft] = useState<Draft>(() => {
    const existing = appointmentId ? draftFor(appointmentId) : undefined;
    return existing
      ? { id: existing.id, appointmentId: existing.appointment_id ?? '', body: existing.body }
      : { id: null, appointmentId: appointmentId ?? '', body: '' };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [rectifying, setRectifying] = useState<ClinicalNote | null>(null);
  const [versionsOf, setVersionsOf] = useState<ClinicalNote | null>(null);
  const [discarding, setDiscarding] = useState<ClinicalNote | null>(null);

  // Sessões realizadas ainda sem evolução (as que já têm rascunho aparecem na lista, para continuar).
  const sessions = pending.filter((item) => item.note_status === 'pending' || item.appointment_id === draft.appointmentId);

  async function save(): Promise<string | null> {
    if (!draft.body.trim()) { setError('Escreva a evolução antes de salvar.'); return null; }
    setBusy(true);
    setError('');
    try {
      const id = await api.saveClinicalNote({
        id: draft.id, patientId, appointmentId: draft.appointmentId || null, kind: 'evolution', body: draft.body
      });
      setDraft((current) => ({ ...current, id }));
      return id;
    } catch (failure) {
      setError(errorMessage(failure));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title={draft.id ? 'Continuar rascunho' : 'Nova evolução'}>
        <div className="panel-body stack">
          <label className="field">
            <span>Sessão</span>
            <select className="input" name="appointmentId" value={draft.appointmentId}
              onChange={(event) => setDraft({ ...draft, appointmentId: event.target.value })}>
              <option value="">Sem sessão vinculada</option>
              {sessions.map((item) => (
                <option key={item.appointment_id} value={item.appointment_id}>
                  {sessionLabel(item.starts_at)}{item.overdue ? ' (fora do prazo)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Evolução</span>
            <textarea className="input" name="body" rows={8} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
          </label>
          {error && <p className="erro" role="alert">{error}</p>}
          <div className="record-actions">
            <button type="button" className="button light" disabled={busy} onClick={async () => {
              if (await save()) { notify('Rascunho salvo.'); onChanged(); }
            }}>Salvar rascunho</button>
            <button type="button" className="button" disabled={busy || !draft.body.trim()} onClick={() => setFinalizing(true)}>Finalizar evolução</button>
            {draft.id && (
              <button type="button" className="link-btn" onClick={() => setDraft({ id: null, appointmentId: '', body: '' })}>Nova evolução</button>
            )}
          </div>
          <p className="muted small">Rascunhos podem ser editados (cada alteração guarda a versão anterior). Depois de finalizada, a evolução só pode ser corrigida por retificação.</p>
        </div>
      </Panel>

      <Panel title="Histórico de evoluções">
        {notes.length ? notes.map((note) => (
          <NoteEntry key={note.id} note={note} notes={notes} fromAi={aiNotes?.has(note.id) ?? false}
            onEdit={() => setDraft({ id: note.id, appointmentId: note.appointment_id ?? '', body: note.body })}
            onDiscard={() => setDiscarding(note)} onRectify={() => setRectifying(note)} onVersions={() => setVersionsOf(note)} />
        )) : <p className="empty-state">Nenhuma evolução registrada.</p>}
      </Panel>

      {finalizing && (
        <ConfirmModal title="Finalizar evolução" confirmLabel="Finalizar" onClose={() => setFinalizing(false)} onConfirm={async () => {
          const id = await save();
          if (!id) throw new Error('Não foi possível salvar antes de finalizar.');
          await api.finalizeClinicalNote(id);
          notify('Evolução finalizada.');
          setDraft({ id: null, appointmentId: '', body: '' });
          onChanged();
        }}>
          <p className="modal-text">Depois de finalizada, a evolução não pode mais ser editada nem apagada. Correções serão feitas por retificação, que fica registrada junto ao original.</p>
        </ConfirmModal>
      )}
      {discarding && (
        <ConfirmModal title="Descartar rascunho" confirmLabel="Descartar" onClose={() => setDiscarding(null)} onConfirm={async () => {
          await api.deleteClinicalNote(discarding.id);
          if (draft.id === discarding.id) setDraft({ id: null, appointmentId: '', body: '' });
          notify('Rascunho descartado.');
          onChanged();
        }}>
          <p className="modal-text">O rascunho e as versões anteriores dele serão apagados.</p>
        </ConfirmModal>
      )}
      {rectifying && (
        <FormModal title="Retificar evolução" submitLabel="Registrar retificação" onClose={() => setRectifying(null)} onSubmit={async (data) => {
          await api.rectifyClinicalNote(rectifying.id, text(data, 'body'), text(data, 'reason'));
          notify('Retificação registrada.');
          onChanged();
        }}>
          <p className="modal-text full">O registro original continua no prontuário, marcado como retificado. O texto abaixo é registrado como uma nova evolução finalizada, ligada a ele.</p>
          <Field label="Texto corrigido" full><textarea className="input" name="body" rows={8} required defaultValue={rectifying.body} /></Field>
          <Field label="Motivo da retificação" full><input className="input" name="reason" required maxLength={500} placeholder="Ex.: erro de digitação, informação incompleta" /></Field>
        </FormModal>
      )}
      {versionsOf && <Versions note={versionsOf} onClose={() => setVersionsOf(null)} />}
    </>
  );
}

interface NoteEntryProps {
  note: ClinicalNote;
  notes: ClinicalNote[];
  onEdit: () => void;
  onDiscard: () => void;
  onRectify: () => void;
  onVersions: () => void;
  fromAi: boolean;
}

function NoteEntry({ note, notes, fromAi, onEdit, onDiscard, onRectify, onVersions }: NoteEntryProps) {
  const original = note.rectifies_id ? notes.find((item) => item.id === note.rectifies_id) : null;
  return (
    <article className={note.rectified_by ? 'entry rectified' : 'entry'}>
      <div className="entry-head">
        <strong>{note.appointment_starts_at ? `Sessão de ${longDay(note.appointment_starts_at)}, ${time(note.appointment_starts_at)}` : `Registro de ${dateTime(note.created_at)}`}</strong>
        <span className={note.status === 'draft' ? 'note-badge draft' : 'note-badge'}>
          {note.status === 'draft' ? 'Rascunho' : note.rectifies_id ? `Retificação, ${dateTime(note.finalized_at)}` : `Finalizada em ${dateTime(note.finalized_at)}`}
        </span>
        {fromAi && <span className="note-badge ai" title="O texto partiu de um rascunho do assistente de IA, revisado pela profissional">{note.status === 'draft' ? 'Rascunho de IA: revise antes de finalizar' : 'Partiu de rascunho de IA revisado'}</span>}
      </div>
      {note.rectifies_id && (
        <p className="muted small">Retifica o registro {original?.finalized_at ? `finalizado em ${dateTime(original.finalized_at)}` : 'anterior'}. Motivo: {note.rectification_reason}</p>
      )}
      <p>{note.body}</p>
      {note.rectified_by && <p className="muted small">Este registro foi retificado; a correção aparece no histórico.</p>}
      <div className="entry-actions">
        {note.status === 'draft' ? (
          <>
            <button type="button" className="link-btn" onClick={onEdit}>Editar</button>
            <button type="button" className="link-btn danger" onClick={onDiscard}>Descartar</button>
          </>
        ) : <button type="button" className="link-btn" onClick={onRectify}>Retificar</button>}
        {note.revisions > 0 && <button type="button" className="link-btn plain" onClick={onVersions}>Versões anteriores ({note.revisions})</button>}
      </div>
    </article>
  );
}

function Versions({ note, onClose }: { note: ClinicalNote; onClose: () => void }) {
  const { data, error } = useLoad(() => api.noteRevisions(note.id), [note.id]);
  return (
    <Modal title="Versões anteriores" onClose={onClose}>
      <div className="modal-body">
        {error && <p className="erro" role="alert">{error}</p>}
        {!data && !error && <p className="muted">Carregando…</p>}
        {data?.map((version, index) => (
          <article key={index} className="entry">
            <div className="entry-head"><strong>Salva em {dateTime(version.saved_at)}</strong></div>
            <p>{version.body}</p>
          </article>
        ))}
      </div>
    </Modal>
  );
}
