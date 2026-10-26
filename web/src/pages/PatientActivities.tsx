import { Select } from '../components/Select.tsx';
import { useState } from 'react';
import type { PatientActivity, PatientActivityChecklistItem } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { dateOnly } from '../format.ts';
import { errorMessage, text, useLoad } from '../hooks.ts';

export function PatientActivitiesPage({ isOwner = false }: { isOwner?: boolean }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(api.patientActivities, []);
  const { data: patients } = useLoad(api.patientActivityPatients, []);
  const [editing, setEditing] = useState<PatientActivity | 'new' | null>(null);
  const [selectedPatient, setSelectedPatient] = useState('');
  const [selectedProfessional, setSelectedProfessional] = useState('');
  const [checklist, setChecklist] = useState<PatientActivityChecklistItem[]>([]);
  const { data: professionals } = useLoad(
    () => !isOwner ? Promise.resolve([])
      : selectedPatient ? api.patientActivityProfessionals(selectedPatient)
        : api.professionals().then((items) => items.filter((item) => item.active).map(({ id, name }) => ({ id, name }))),
    [isOwner, selectedPatient]);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('assigned');
  const items = (data ?? []).filter((item) => filter === 'all' || item.status === filter);

  async function cancel(item: PatientActivity) {
    if (!window.confirm(`Cancelar a tarefa "${item.title}"?`)) return;
    setBusy(item.id);
    try {
      await api.cancelPatientActivity(item.id);
      notify('Tarefa cancelada.');
      reload();
    } catch (failure) { notify(errorMessage(failure)); }
    finally { setBusy(''); }
  }

  return <>
    <Heading title="Tarefas" lead="Crie tarefas para os pacientes e acompanhe as respostas enviadas pelo portal.">
      <button type="button" className="button" onClick={() => { setSelectedPatient(''); setSelectedProfessional(''); setChecklist([]); setEditing('new'); }}>Nova tarefa para paciente</button>
    </Heading>
    <div className="tabs spaced-tabs" role="tablist" aria-label="Situação das tarefas para pacientes">
      <button type="button" role="tab" aria-selected={filter === 'assigned'} className={filter === 'assigned' ? 'tab on' : 'tab'} onClick={() => setFilter('assigned')}>Em aberto</button>
      <button type="button" role="tab" aria-selected={filter === 'completed'} className={filter === 'completed' ? 'tab on' : 'tab'} onClick={() => setFilter('completed')}>Concluídas</button>
      <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'tab on' : 'tab'} onClick={() => setFilter('all')}>Todas</button>
    </div>
    <Panel title="Tarefas enviadas aos pacientes">
      {items.length ? <div className="table-wrap"><table className="table">
        <thead><tr><th>Paciente</th>{isOwner && <th>Profissional</th>}<th>Atividade</th><th>Prazo</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{items.map((item) => <tr key={item.id}>
          <td>{item.patient_name}</td>
          {isOwner && <td>{item.professional_name}</td>}
          <td><strong>{item.title}</strong><span className="sub pre">{item.instructions}</span>
            {item.checklist?.length > 0 && <span className="sub">Checklist: {item.checklist.filter((entry) => entry.completed_at).length}/{item.checklist.length} concluídos
              <span className="activity-checklist-summary">{item.checklist.map((entry) => <span key={entry.id}>{entry.completed_at ? '✓' : '○'} {entry.text}</span>)}</span>
            </span>}
            {item.patient_response && <span className="sub pre"><strong>Resposta:</strong> {item.patient_response}</span>}</td>
          <td>{item.due_date ? dateOnly(item.due_date) : 'Sem prazo'}</td>
          <td>{item.status === 'assigned' ? 'Em aberto' : item.status === 'completed' ? `Concluída em ${dateOnly(item.completed_at!)}` : 'Cancelada'}</td>
          <td className="actions-cell">{item.status === 'assigned' && <>
            <button type="button" className="link-btn" onClick={() => { setSelectedPatient(item.patient_id); setSelectedProfessional(item.professional_id); setChecklist(item.checklist ?? []); setEditing(item); }}>Editar</button>
            <button type="button" className="link-btn danger" disabled={busy === item.id} onClick={() => cancel(item)}>Cancelar</button>
          </>}</td>
        </tr>)}</tbody>
      </table></div> : <PanelState error={error} loading={!data} empty="Nenhuma tarefa nesta situação." />}
    </Panel>
    {editing && <FormModal title={editing === 'new' ? 'Nova tarefa para paciente' : 'Editar tarefa'}
      submitLabel={editing === 'new' ? 'Enviar tarefa' : 'Salvar'} onClose={() => setEditing(null)}
      onSubmit={async (form) => {
        if (checklist.some((entry) => !entry.text.trim())) throw new Error('Preencha ou remova os itens vazios do checklist.');
        await api.savePatientActivity(editing === 'new' ? null : editing.id, text(form, 'patient'),
          text(form, 'title'), text(form, 'instructions'), text(form, 'dueDate') || null,
          isOwner ? text(form, 'professional') : null, checklist.map(({ id, text }) => ({ id, text: text.trim() })));
        notify(editing === 'new' ? 'Tarefa enviada ao portal do paciente.' : 'Tarefa atualizada.');
        reload();
      }}>
      <Field label="Paciente" full><Select className="input" name="patient" required value={selectedPatient} disabled={editing !== 'new'}
        onChange={(event) => { setSelectedPatient(event.target.value); setSelectedProfessional(''); }}>
        <option value="">Selecione</option>
        {(patients ?? []).map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
      </Select>{editing !== 'new' && <input type="hidden" name="patient" value={editing.patient_id} />}
        {patients && !patients.length && <span className="muted small">Cadastre um paciente e vincule uma profissional antes de enviar a primeira tarefa.</span>}
      </Field>
      {isOwner && <Field label="Profissional responsável" full><Select className="input" name="professional" required
        value={selectedProfessional} onChange={(event) => setSelectedProfessional(event.target.value)}>
        <option value="">Selecione</option>
        {(professionals ?? []).map((professional) => <option key={professional.id} value={professional.id}>{professional.name}</option>)}
      </Select>{selectedPatient && professionals && !professionals.length &&
        <span className="muted small">Vincule uma profissional a este paciente no cadastro antes de enviar a tarefa.</span>}
      </Field>}
      <Field label="Título" full><input className="input" name="title" required maxLength={200} defaultValue={editing === 'new' ? '' : editing.title} /></Field>
      <section className="activity-checklist-card full" aria-labelledby="activity-checklist-title">
        <div className="activity-checklist-heading">
          <span className="activity-checklist-heading-icon" aria-hidden="true">✓</span>
          <div><strong id="activity-checklist-title">Checklist para o paciente</strong>
            <span>Divida a tarefa em passos simples.</span></div>
          <span className="activity-checklist-count">{checklist.length ? `${checklist.length} ${checklist.length === 1 ? 'item' : 'itens'}` : 'Opcional'}</span>
        </div>
        <div className="activity-checklist-editor">{checklist.length === 0 && <div className="activity-checklist-empty">
          <span className="activity-checklist-empty-icon" aria-hidden="true">☐</span>
          <span>Nenhum item adicionado ainda.</span>
        </div>}{checklist.map((entry, index) => <div className="activity-checklist-row" key={entry.id}>
          <span className="activity-checklist-number" aria-hidden="true">{index + 1}</span>
          <input className="input" aria-label={`Item ${index + 1} do checklist`} maxLength={200} value={entry.text}
            disabled={Boolean(entry.completed_at)} placeholder="O que o paciente deve fazer?"
            onChange={(event) => setChecklist((current) => current.map((item) => item.id === entry.id ? { ...item, text: event.target.value } : item))} />
          {!entry.completed_at && <button type="button" className="link-btn danger" aria-label={`Remover item ${index + 1}`}
            onClick={() => setChecklist((current) => current.filter((item) => item.id !== entry.id))}>Remover</button>}
          {entry.completed_at && <span className="muted small">Concluído</span>}
        </div>)}</div>
        {checklist.length < 20 && <button type="button" className="activity-checklist-add" onClick={() => setChecklist((current) => [...current,
          { id: crypto.randomUUID(), text: '', completed_at: null }])}>
          <span className="activity-checklist-add-icon" aria-hidden="true">+</span>Adicionar item ao checklist</button>}
        <p className="activity-checklist-help">O paciente marca cada item quando o concluir.</p>
      </section>
      <Field label="Orientações para o paciente" full><textarea className="input" name="instructions" rows={5} required maxLength={4000} defaultValue={editing === 'new' ? '' : editing.instructions} /></Field>
      <Field label="Prazo (opcional)"><input className="input" name="dueDate" type="date" defaultValue={editing === 'new' ? '' : editing.due_date ?? ''} /></Field>
      <p className="muted small full">A tarefa aparece no portal das pessoas com acesso a este paciente.</p>
    </FormModal>}
  </>;
}
