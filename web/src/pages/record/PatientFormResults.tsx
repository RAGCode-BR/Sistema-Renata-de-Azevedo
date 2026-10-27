import { api } from '../../api.ts';
import { Panel, PanelState } from '../../components/Page.tsx';
import { dateOnly } from '../../format.ts';
import { useLoad } from '../../hooks.ts';

export function PatientFormResults({ patientId }: { patientId: string }) {
  const { data, error } = useLoad(() => api.clinicalPatientFormResults(patientId), [patientId]);
  return <Panel title="Formulários e escalas respondidos">
    {!data ? <PanelState error={error} loading={!error} empty="" />
      : data.length ? <div className="form-result-list">{data.map((form) => <article className="form-result-card" key={form.id}>
        <span className="muted small">Respondido em {dateOnly(form.completed_at)} · {form.kind === 'scale' ? 'Escala' : form.kind === 'exercise' ? 'Exercício' : 'Formulário'}</span>
        <h3>{form.title}</h3>
        {form.description && <p className="muted pre">{form.description}</p>}
        {form.score !== null && <p className="form-result-score">Pontuação: {Number(form.score)} de {Number(form.score_max)}
          <span className="muted small">Soma das respostas, sem interpretação clínica automática.</span></p>}
        <dl className="facts">{form.questions.map((q) => <div className="form-result-answer" key={q.id}>
          <dt>{q.label}</dt><dd className="pre">{q.type === 'choice' || q.type === 'scale'
            ? q.options?.[Number(form.answers?.[q.id])] ?? '—' : form.answers?.[q.id] || '—'}</dd>
        </div>)}</dl>
      </article>)}</div>
        : <PanelState error="" loading={false} empty="Nenhum formulário respondido por este paciente." />}
  </Panel>;
}
