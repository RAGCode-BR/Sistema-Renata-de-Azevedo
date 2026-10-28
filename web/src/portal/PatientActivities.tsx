import { useState } from 'react';
import { api } from '../api.ts';
import { Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { dateOnly, dayOf } from '../format.ts';
import { errorMessage, useLoad } from '../hooks.ts';

export function PatientActivities({ patientId }: { patientId: string }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(() => api.portalPatientActivities(patientId), [patientId]);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const open = (data ?? []).filter((item) => item.status === 'assigned');
  const completed = (data ?? []).filter((item) => item.status === 'completed');

  async function complete(id: string) {
    setBusy(id);
    try {
      await api.portalCompletePatientActivity(id, responses[id] ?? '');
      notify('Tarefa concluída. Sua profissional poderá ver sua resposta.');
      reload();
    } catch (failure) { notify(errorMessage(failure)); }
    finally { setBusy(''); }
  }

  async function completeItem(id: string, itemId: string) {
    setBusy(itemId);
    try {
      await api.portalCompletePatientActivityItem(id, itemId);
      reload();
    } catch (failure) { notify(errorMessage(failure)); }
    finally { setBusy(''); }
  }

  const list = (items: typeof open) => <ul className="portal-list">{items.map((item) => <li className="portal-item" key={item.id}>
    <div>
      <strong>{item.title}</strong>
      <span>{item.professional_name}{item.due_date ? ` · até ${dateOnly(item.due_date)}` : ''}</span>
      <p className="pre">{item.instructions}</p>
      {item.checklist?.length > 0 && <div className="portal-activity-checklist" aria-label="Checklist da tarefa">
        <span className="muted small">{item.checklist.filter((entry) => entry.completed_at).length} de {item.checklist.length} itens concluídos</span>
        {item.checklist.map((entry) => <label className="check" key={entry.id}>
          <input type="checkbox" checked={Boolean(entry.completed_at)}
            disabled={Boolean(entry.completed_at) || item.status !== 'assigned' || Boolean(busy)}
            onChange={() => completeItem(item.id, entry.id)} />
          <span>{entry.text}</span>
        </label>)}
      </div>}
      {item.status === 'completed' && <span className="muted small">Concluída em {dayOf(item.completed_at!)}{item.patient_response ? ` · Sua resposta: ${item.patient_response}` : ''}</span>}
    </div>
    {item.status === 'assigned' && <div className="portal-actions">
      <label className="field"><span>Resposta para a profissional (opcional)</span>
        <textarea className="input" rows={3} maxLength={4000} value={responses[item.id] ?? ''}
          onChange={(event) => setResponses({ ...responses, [item.id]: event.target.value })} /></label>
      <button type="button" className="button" disabled={Boolean(busy) || item.checklist?.some((entry) => !entry.completed_at)} onClick={() => complete(item.id)}>
        {busy === item.id ? 'Enviando…' : 'Marcar como concluída'}</button>
      {item.checklist?.some((entry) => !entry.completed_at) && <span className="muted small">Conclua todos os itens do checklist para finalizar a tarefa.</span>}
    </div>}
  </li>)}</ul>;

  return <>
    <h1 className="portal-title">Tarefas</h1>
    <Panel title="Para fazer">{open.length ? list(open) : <PanelState error={error} loading={!data} empty="Nenhuma atividade em aberto." />}</Panel>
    {completed.length > 0 && <Panel title="Concluídas">{list(completed)}</Panel>}
  </>;
}
