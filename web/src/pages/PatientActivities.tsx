import { Select } from '../components/Select.tsx';
import { useState } from 'react';
import type { PatientActivity, PatientActivityChecklistItem } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { dateOnly, dayOf } from '../format.ts';
import { errorMessage, text, useLoad } from '../hooks.ts';

export function PatientActivitiesPage({ isOwner = false, initialPatient = null }: { isOwner?: boolean; initialPatient?: string | null }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(api.patientActivities, []);
  const { data: patients } = useLoad(api.patientActivityPatients, []);
  const [editing, setEditing] = useState<PatientActivity | 'new' | null>(initialPatient ? 'new' : null);
  const [selectedPatient, setSelectedPatient] = useState(initialPatient ?? '');
  const [selectedProfessional, setSelectedProfessional] = useState('');
  const [sourceMessage, setSourceMessage] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftInstructions, setDraftInstructions] = useState('');
  const [transcribing, setTranscribing] = useState('');
  const sources = useLoad(async () => ({ patientId: selectedPatient, items: selectedPatient && editing === 'new'
    ? await api.patientWhatsappTaskSources(selectedPatient) : [] }), [selectedPatient, editing === 'new']);
  const sourceRows = sources.data?.patientId === selectedPatient ? sources.data.items : undefined;
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
      <button type="button" className="button" onClick={() => { setSelectedPatient(''); setSelectedProfessional(''); setSourceMessage(''); setDraftTitle(''); setDraftInstructions(''); setChecklist([]); setEditing('new'); }}>Nova tarefa para paciente</button>
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
          <td>{item.status === 'assigned' ? 'Em aberto' : item.status === 'completed' ? `Concluída em ${dayOf(item.completed_at!)}` : 'Cancelada'}</td>
          <td className="actions-cell">{item.status === 'assigned' && <>
            <button type="button" className="link-btn" onClick={() => { setSelectedPatient(item.patient_id); setSelectedProfessional(item.professional_id); setSourceMessage(''); setDraftTitle(item.title); setDraftInstructions(item.instructions); setChecklist(item.checklist ?? []); setEditing(item); }}>Editar</button>
            <button type="button" className="link-btn danger" disabled={busy === item.id} onClick={() => cancel(item)}>Cancelar</button>
          </>}</td>
        </tr>)}</tbody>
      </table></div> : <PanelState error={error} loading={!data} empty="Nenhuma tarefa nesta situação." />}
    </Panel>
    {editing && <FormModal title={editing === 'new' ? 'Nova tarefa para paciente' : 'Editar tarefa'}
      submitLabel={editing === 'new' ? 'Enviar tarefa' : 'Salvar'} onClose={() => setEditing(null)}
      onSubmit={async (form) => {
        if (checklist.some((entry) => !entry.text.trim())) throw new Error('Preencha ou remova os itens vazios do checklist.');
        const args = [editing === 'new' ? null : editing.id, text(form, 'patient'),
          draftTitle.trim(), draftInstructions.trim(), text(form, 'dueDate') || null,
          isOwner ? text(form, 'professional') : null,
          checklist.map(({ id, text }) => ({ id, text: text.trim() }))] as const;
        if (sourceMessage && editing === 'new') await api.savePatientActivityFromWhatsapp(...args, sourceMessage);
        else await api.savePatientActivity(...args);
        notify(editing === 'new' ? 'Tarefa enviada ao portal do paciente.' : 'Tarefa atualizada.');
        reload();
      }}>
      <Field label="Paciente" full><Select className="input" name="patient" required value={selectedPatient} disabled={editing !== 'new'}
        onChange={(event) => { setSelectedPatient(event.target.value); setSelectedProfessional(''); setSourceMessage('');
          setDraftTitle(''); setDraftInstructions(''); }}>
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
      {editing === 'new' && selectedPatient && <section className="activity-whatsapp-source full" aria-label="Criar tarefa de uma mensagem do WhatsApp">
        <div className="activity-whatsapp-heading"><strong>Usar mensagem do WhatsApp</strong>
          <span>Escolha uma mensagem recebida e revise o texto antes de enviar.</span></div>
        {sources.error && <p className="muted small">{sources.error}</p>}
        {!sourceRows && !sources.error && <p className="muted small">Buscando mensagens…</p>}
        {!sources.error && sourceRows?.length === 0 && <p className="muted small">Nenhuma mensagem recebida deste paciente no número oficial da clínica.</p>}
        {sourceRows && sourceRows.length > 0 && <div className="activity-whatsapp-list">
          {sourceRows.map((message) => {
            const content = message.audio ? message.transcript : message.body;
            return <div className={sourceMessage === message.id ? 'activity-whatsapp-item selected' : 'activity-whatsapp-item'} key={message.id}>
              <span className="muted small">{message.audio ? 'Áudio' : 'Mensagem'} · {dayOf(message.created_at)}</span>
              <p className="pre">{content || 'Áudio ainda não transcrito.'}</p>
              {message.audio && !message.transcript
                ? <button type="button" className="button light" disabled={Boolean(transcribing)} onClick={async () => {
                  setTranscribing(message.id);
                  try { await api.transcribePatientWhatsappAudio(message.id); sources.reload(); notify('Áudio transcrito. Revise o texto antes de usar.'); }
                  catch (failure) { notify(errorMessage(failure)); }
                  finally { setTranscribing(''); }
                }}>{transcribing === message.id ? 'Transcrevendo…' : 'Transcrever áudio'}</button>
                : <button type="button" className="button light" onClick={() => {
                  const candidate = (content ?? '').trim();
                  setSourceMessage(message.id);
                  setDraftTitle(candidate.split(/[.!?\n]/)[0].slice(0, 120) || 'Tarefa para o paciente');
                  setDraftInstructions(candidate.slice(0, 4000));
                }}>{sourceMessage === message.id ? 'Mensagem selecionada' : 'Usar como rascunho'}</button>}
            </div>;
          })}
        </div>}
      </section>}
      <Field label="Título" full><input className="input" name="title" required maxLength={200} value={draftTitle}
        onChange={(event) => setDraftTitle(event.target.value)} /></Field>
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
      <Field label="Orientações para o paciente" full><textarea className="input" name="instructions" rows={5} required maxLength={4000}
        value={draftInstructions} onChange={(event) => setDraftInstructions(event.target.value)} /></Field>
      <Field label="Prazo (opcional)"><input className="input" name="dueDate" type="date" defaultValue={editing === 'new' ? '' : editing.due_date ?? ''} /></Field>
      <p className="muted small full">A tarefa aparece no portal das pessoas com acesso a este paciente.</p>
    </FormModal>}
  </>;
}
