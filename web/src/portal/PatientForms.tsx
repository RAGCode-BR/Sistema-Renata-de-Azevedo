import { useState } from 'react';
import type { PatientFormAssignment } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Panel, PanelState } from '../components/Page.tsx';
import { Select } from '../components/Select.tsx';
import { useToast } from '../components/Toast.tsx';
import { dateOnly } from '../format.ts';
import { errorMessage, useLoad } from '../hooks.ts';

const kindLabel = { exercise: 'Exercício', form: 'Formulário', scale: 'Escala' };

export function PatientForms({ patientId }: { patientId: string }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(() => api.portalPatientForms(patientId), [patientId]);
  const [answers, setAnswers] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState('');
  const pending = (data ?? []).filter((item) => item.status === 'assigned');
  const completed = (data ?? []).filter((item) => item.status === 'completed');
  const answer = (formId: string, questionId: string, value: string) => setAnswers((current) => ({ ...current,
    [formId]: { ...current[formId], [questionId]: value } }));

  async function submit(form: PatientFormAssignment) {
    const values = answers[form.id] ?? {};
    if (form.questions.some((q) => q.required && !values[q.id]?.trim())) {
      notify('Responda todas as perguntas obrigatórias.'); return;
    }
    setBusy(form.id);
    try {
      await api.portalSubmitPatientForm(form.id, values);
      notify('Respostas enviadas à profissional.'); reload();
    } catch (failure) { notify(errorMessage(failure)); }
    finally { setBusy(''); }
  }

  const card = (form: PatientFormAssignment) => <li className="portal-item portal-form-card" key={form.id}>
    <div><span className="muted small">{kindLabel[form.kind]}{form.due_date ? ` · até ${dateOnly(form.due_date)}` : ''}</span>
      <strong>{form.title}</strong>{form.description && <p className="pre">{form.description}</p>}
      {form.status === 'completed' && <span className="muted small">Respondido em {dateOnly(form.completed_at)}.</span>}
    </div>
    {form.status === 'assigned' && <div className="portal-form-questions">
      {form.questions.map((q, index) => <label className="field" key={q.id}>
        <span>{index + 1}. {q.label}{q.required ? ' *' : ''}</span>
        {q.type === 'text' && <textarea className="input" rows={3} maxLength={2000}
          value={answers[form.id]?.[q.id] ?? ''} onChange={(event) => answer(form.id, q.id, event.target.value)} />}
        {q.type === 'number' && <input className="input" type="number" step="any" value={answers[form.id]?.[q.id] ?? ''}
          onChange={(event) => answer(form.id, q.id, event.target.value)} />}
        {(q.type === 'choice' || q.type === 'scale') && <Select className="input" value={answers[form.id]?.[q.id] ?? ''}
          onChange={(event) => answer(form.id, q.id, event.target.value)}>
          <option value="">Selecione</option>{q.options?.map((option, optionIndex) =>
            <option value={String(optionIndex)} key={optionIndex}>{option}</option>)}
        </Select>}
      </label>)}
      <button type="button" className="button" disabled={Boolean(busy)} onClick={() => submit(form)}>
        {busy === form.id ? 'Enviando…' : 'Enviar respostas'}</button>
      <span className="muted small">Depois de enviar, as respostas não poderão ser alteradas.</span>
    </div>}
    {form.status === 'completed' && form.answers && <div className="portal-form-answers">
      {form.questions.map((q) => <div key={q.id}><strong>{q.label}</strong><span className="pre">
        {q.type === 'choice' || q.type === 'scale' ? q.options?.[Number(form.answers?.[q.id])] ?? '—'
          : form.answers?.[q.id] || '—'}</span></div>)}
    </div>}
  </li>;
  return <>
    <h1 className="portal-title">Formulários e exercícios</h1>
    <Panel title="Para responder">{pending.length ? <ul className="portal-list">{pending.map(card)}</ul>
      : <PanelState error={error} loading={!data} empty="Nada para responder agora." />}</Panel>
    {completed.length > 0 && <Panel title="Enviados"><ul className="portal-list">{completed.map(card)}</ul></Panel>}
  </>;
}
