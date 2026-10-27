import { useState } from 'react';
import type { PatientFormKind, PatientFormQuestion, PatientFormTemplate } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { Select } from '../components/Select.tsx';
import { useToast } from '../components/Toast.tsx';
import { dateOnly } from '../format.ts';
import { errorMessage, text, useLoad } from '../hooks.ts';

const labels: Record<PatientFormKind, string> = { exercise: 'Exercício', form: 'Formulário', scale: 'Escala' };
const questionTypes = { text: 'Resposta em texto', number: 'Número', choice: 'Escolha', scale: 'Escala com pontos' };
const question = (type: PatientFormQuestion['type'] = 'text'): PatientFormQuestion => ({ id: crypto.randomUUID(),
  label: '', type, required: true, ...(type === 'scale' ? { options: ['Nunca', 'Raramente', 'Às vezes', 'Frequentemente', 'Sempre'] }
    : type === 'choice' ? { options: ['Sim', 'Não'] } : {}) });

export function PatientFormsPage() {
  const notify = useToast();
  const templates = useLoad(api.patientFormTemplates, []);
  const assignments = useLoad(api.patientFormAssignments, []);
  const patients = useLoad(api.patients, []);
  const [editing, setEditing] = useState<PatientFormTemplate | 'new' | null>(null);
  const [assigning, setAssigning] = useState<PatientFormTemplate | null>(null);
  const [kind, setKind] = useState<PatientFormKind>('exercise');
  const [questions, setQuestions] = useState<PatientFormQuestion[]>([question()]);
  const [cancelling, setCancelling] = useState('');
  const update = (id: string, changes: Partial<PatientFormQuestion>) =>
    setQuestions((current) => current.map((entry) => entry.id === id ? { ...entry, ...changes } : entry));
  function edit(template: PatientFormTemplate | 'new') {
    setEditing(template);
    setKind(template === 'new' ? 'exercise' : template.kind);
    setQuestions(template === 'new' ? [question()] : template.questions);
  }
  return <>
    <Heading title="Formulários e escalas" lead="Crie exercícios e perguntas para seus pacientes responderem no portal.">
      <button type="button" className="button" onClick={() => edit('new')}>Criar modelo</button>
    </Heading>
    <Panel title="Meus modelos">
      {!templates.data ? <PanelState error={templates.error} loading={!templates.error} empty="" />
        : templates.data.length ? <div className="form-template-grid">{templates.data.map((template) =>
          <article className="form-template-card" key={template.id}>
            <span className="muted small">{labels[template.kind]} · {template.questions.length} perguntas</span>
            <strong>{template.title}</strong><p>{template.description || 'Sem descrição.'}</p>
            <div className="form-template-actions">
              <button type="button" className="button light" onClick={() => setAssigning(template)}>Enviar ao paciente</button>
              <button type="button" className="link-btn" onClick={() => edit(template)}>Editar modelo</button>
            </div>
          </article>)}</div> : <PanelState error="" loading={false} empty="Nenhum modelo criado ainda." />}
    </Panel>
    <Panel title="Enviados aos pacientes">
      {!assignments.data ? <PanelState error={assignments.error} loading={!assignments.error} empty="" />
        : assignments.data.length ? <div className="table-wrap"><table className="table">
          <thead><tr><th>Paciente</th><th>Conteúdo</th><th>Enviado</th><th>Prazo</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
          <tbody>{assignments.data.map((item) => <tr key={item.id}>
            <td>{item.patient_name}</td><td>{item.title}</td><td>{dateOnly(item.assigned_at)}</td>
            <td>{dateOnly(item.due_date)}</td><td>{item.status === 'completed'
              ? <a href={`#/prontuarios?paciente=${item.patient_id}`}>Respondido · abrir prontuário</a>
              : item.status === 'cancelled' ? 'Cancelado' : 'Aguardando resposta'}</td>
            <td>{item.status === 'assigned' && <button type="button" className="link-btn danger" disabled={Boolean(cancelling)}
              onClick={async () => { if (!window.confirm(`Cancelar o envio de "${item.title}"?`)) return;
                setCancelling(item.id);
                try { await api.cancelPatientForm(item.id); assignments.reload(); notify('Envio cancelado.'); }
                catch (failure) { notify(errorMessage(failure)); }
                finally { setCancelling(''); }
              }}>Cancelar</button>}</td>
          </tr>)}</tbody>
        </table></div> : <PanelState error="" loading={false} empty="Nenhum formulário enviado ainda." />}
    </Panel>
    {editing && <FormModal title={editing === 'new' ? 'Novo modelo' : 'Editar modelo'} submitLabel="Salvar modelo"
      onClose={() => setEditing(null)} onSubmit={async (form) => {
        if (questions.some((item) => !item.label.trim())) throw new Error('Preencha todas as perguntas.');
        if (questions.some((item) => (item.type === 'choice' || item.type === 'scale') &&
          (!item.options || item.options.length < 2 || item.options.some((option) => !option.trim()))))
          throw new Error('Cada escolha ou escala precisa de pelo menos duas opções preenchidas.');
        await api.savePatientFormTemplate(editing === 'new' ? null : editing.id,
          text(form, 'title'), text(form, 'description'), kind, questions);
        templates.reload(); notify('Modelo salvo.');
      }}>
      <Field label="Título *" full><input className="input" name="title" required maxLength={200}
        defaultValue={editing === 'new' ? '' : editing.title} placeholder="Ex.: Diário de emoções" /></Field>
      <Field label="Tipo"><Select className="input" value={kind} onChange={(event) => {
        const next = event.target.value as PatientFormKind;
        setKind(next);
        if (next === 'scale' && !questions.some((entry) => entry.type === 'scale'))
          setQuestions((current) => current.map((entry, index) => index === 0 ? {
            ...entry, type: 'scale', options: ['Nunca', 'Raramente', 'Às vezes', 'Frequentemente', 'Sempre'], required: true
          } : entry));
      }}>
        {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select></Field>
      <Field label="Orientação geral" full><textarea className="input" name="description" rows={3} maxLength={2000}
        defaultValue={editing === 'new' ? '' : editing.description} placeholder="Explique como preencher" /></Field>
      <section className="form-question-builder full"><h3>Perguntas</h3>
        {questions.map((item, index) => <div className="form-question-edit" key={item.id}>
          <div className="form-question-heading"><strong>Pergunta {index + 1}</strong>
            {questions.length > 1 && <button type="button" className="link-btn danger"
              onClick={() => setQuestions(questions.filter((entry) => entry.id !== item.id))}>Remover</button>}</div>
          <input className="input" aria-label={`Texto da pergunta ${index + 1}`} maxLength={300}
            value={item.label} placeholder="Escreva a pergunta" onChange={(event) => update(item.id, { label: event.target.value })} />
          <div className="form-question-controls"><label className="field">Resposta
            <Select className="input" value={item.type} onChange={(event) => {
              const type = event.target.value as PatientFormQuestion['type'];
              update(item.id, { type, options: type === 'scale' ? ['Nunca', 'Raramente', 'Às vezes', 'Frequentemente', 'Sempre']
                : type === 'choice' ? ['Sim', 'Não'] : undefined, reverse: false });
            }}>{Object.entries(questionTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
          </label><label className="check"><input type="checkbox" checked={item.required}
            onChange={(event) => update(item.id, { required: event.target.checked })} />Obrigatória</label></div>
          {(item.type === 'choice' || item.type === 'scale') && <>
            <label className="field">Opções (uma por linha, de 2 a 7)
              <textarea className="input" rows={Math.min(item.options?.length ?? 2, 7)} value={(item.options ?? []).join('\n')}
                onChange={(event) => update(item.id, { options: event.target.value.split('\n').slice(0, 7) })} /></label>
            {item.type === 'scale' && <label className="check"><input type="checkbox" checked={Boolean(item.reverse)}
              onChange={(event) => update(item.id, { reverse: event.target.checked })} />Pontuação invertida nesta pergunta</label>}
          </>}
        </div>)}
        {questions.length < 30 && <button type="button" className="button light" onClick={() =>
          setQuestions([...questions, question(kind === 'scale' ? 'scale' : 'text')])}>+ Adicionar pergunta</button>}
        {kind === 'scale' && <p className="muted small">A pontuação soma a posição marcada em cada escala, começando em zero. O resultado não interpreta diagnósticos.</p>}
      </section>
    </FormModal>}
    {assigning && <FormModal title={`Enviar ${assigning.title}`} submitLabel="Enviar ao portal"
      onClose={() => setAssigning(null)} onSubmit={async (form) => {
        await api.assignPatientForm(assigning.id, text(form, 'patient'), text(form, 'dueDate') || null);
        assignments.reload(); notify('Formulário enviado ao portal do paciente.');
      }}>
      <Field label="Paciente *" full><Select className="input" name="patient" required defaultValue="">
        <option value="">Selecione</option>{(patients.data ?? []).map((patient) =>
          <option key={patient.id} value={patient.id}>{patient.name}</option>)}
      </Select></Field>
      <Field label="Prazo (opcional)"><input className="input" name="dueDate" type="date" /></Field>
      <p className="muted small full">O paciente poderá responder uma vez no portal. O resultado ficará no seu prontuário.</p>
    </FormModal>}
  </>;
}
