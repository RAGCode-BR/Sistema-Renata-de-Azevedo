import { useState } from 'react';
import { api } from '../api.ts';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { dateTime } from '../format.ts';
import { text, useFormSubmit, useLoad } from '../hooks.ts';

export function ClinicalNotesPage() {
  const [patientId, setPatientId] = useState('');
  const { data: patients, error } = useLoad(api.patients, []);
  const active = (patients ?? []).filter((item) => item.status === 'active');

  return (
    <>
      <Heading title="Prontuários" lead="Somente suas anotações clínicas." />

      <Panel title="Paciente">
        <div className="panel-body">
          {error ? <p className="erro" role="alert">{error}</p> : (
            <label className="field">
              <span>Selecionar paciente</span>
              <select className="input" value={patientId} onChange={(event) => setPatientId(event.target.value)}>
                <option value="">{patients ? 'Escolha' : 'Carregando…'}</option>
                {active.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}
        </div>
      </Panel>

      {patientId && <PatientNotes key={patientId} patientId={patientId} />}
    </>
  );
}

function PatientNotes({ patientId }: { patientId: string }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(() => api.clinicalNotes(patientId), [patientId]);
  const { busy, error: saveError, onSubmit } = useFormSubmit(async (form) => {
    await api.createClinicalNote({ patientId, body: text(form, 'body') });
    notify('Evolução salva.');
    reload();
  });
  const notes = data ?? [];

  return (
    <>
      <Panel title="Nova evolução">
        <form className="panel-body stack" onSubmit={onSubmit}>
          <label className="field">
            <span>Anotação</span>
            <textarea className="input" name="body" rows={6} required />
          </label>
          {saveError && <p className="erro" role="alert">{saveError}</p>}
          <button type="submit" className="button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar evolução'}</button>
        </form>
      </Panel>

      <Panel title="Histórico">
        {notes.length ? notes.map((note) => (
          <article key={note.id} className="entry">
            <div className="entry-head"><strong>{dateTime(note.created_at)}</strong></div>
            <p>{note.body}</p>
          </article>
        )) : <PanelState error={error} loading={!data} empty="Sem evoluções registradas." />}
      </Panel>
    </>
  );
}
