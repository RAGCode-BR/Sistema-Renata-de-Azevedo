import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Patient, SessionUser, Task, TaskFrequency, TaskPriority, TaskRecurrence } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal, Modal } from '../../components/Modal.tsx';
import { useToast } from '../../components/Toast.tsx';
import {
  dateTime, dayLabel, frequencyTaskLabel, relativeDay, taskPriorityLabel, taskStatusLabel, todayKey
} from '../../format.ts';
import { errorMessage, text, useFormSubmit, useLoad } from '../../hooks.ts';

const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
const FREQUENCIES = Object.keys(frequencyTaskLabel) as TaskFrequency[];

// Quem vê pacientes pode ligar a tarefa a um deles (vínculo só administrativo).
export function usePatientOptions(user: SessionUser) {
  const sees = can(user, 'patients.view_all') || user.roles.includes('professional');
  return useLoad(() => (sees ? api.patients() : Promise.resolve([] as Patient[])), [sees]).data ?? [];
}

export function dueLabel(task: Pick<Task, 'due_date' | 'due_time'>): string {
  if (!task.due_date) return 'Sem prazo';
  const day = relativeDay(`${task.due_date}T12:00:00`);
  const label = ['hoje', 'amanhã', 'ontem'].includes(day) ? day : dayLabel(task.due_date);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}${task.due_time ? ` às ${task.due_time.slice(0, 5)}` : ''}`;
}

// Nova tarefa (com opção de repetir), edição de tarefa ou edição de regra recorrente.
export function TaskForm({ user, task, recurrence, recurring = false, defaultAssignee, onClose, onSaved }: {
  user: SessionUser; task?: Task; recurrence?: TaskRecurrence; recurring?: boolean; defaultAssignee?: string;
  onClose: () => void; onSaved: () => void;
}) {
  const notify = useToast();
  const assignees = useLoad(api.taskAssignees, []).data;
  const patients = usePatientOptions(user);
  const editingRule = Boolean(recurrence) || recurring;
  const [frequency, setFrequency] = useState<TaskFrequency | ''>(recurrence?.frequency ?? (recurring ? 'monthly' : ''));
  const source = task ?? recurrence;
  // Enquanto a lista carrega, o campo já funciona com a própria pessoa e o responsável atual.
  const loadingAssignees = [{ id: user.id, name: user.name },
    ...(source?.assignee_id && source.assignee_id !== user.id ? [{ id: source.assignee_id, name: source.assignee_name ?? 'Responsável atual' }] : [])];
  const title = task ? 'Editar tarefa' : recurrence ? 'Editar tarefa recorrente' : recurring ? 'Nova tarefa recorrente' : 'Nova tarefa';

  return (
    <FormModal title={title} submitLabel={task || recurrence ? 'Salvar' : 'Criar tarefa'} onClose={onClose} onSubmit={async (data) => {
      const input = {
        title: text(data, 'title'), description: text(data, 'description'), assigneeId: text(data, 'assignee'),
        priority: text(data, 'priority') as TaskPriority, dueDate: text(data, 'dueDate') || null, dueTime: text(data, 'dueTime') || null,
        patientId: text(data, 'patient') || null
      };
      if (!input.assigneeId) throw new Error('Escolha o responsável.');
      if (input.dueTime && !input.dueDate) throw new Error('Para definir horário, informe também a data.');
      if (frequency) {
        if (!input.dueDate) throw new Error('Tarefa recorrente precisa da data da primeira vez.');
        await api.saveRecurrence(recurrence?.id ?? null, { ...input, frequency, startsOn: input.dueDate });
        notify(recurrence ? 'Tarefa recorrente atualizada.' : 'Tarefa recorrente criada.');
      } else {
        await api.saveTask(task?.id ?? null, input);
        notify(task ? 'Tarefa atualizada.' : 'Tarefa criada.');
      }
      onSaved();
    }}>
      <Field label="Título" full><input className="input" name="title" required maxLength={200} defaultValue={source?.title} /></Field>
      <Field label="Descrição (opcional)" full>
        <textarea className="input" name="description" rows={3} maxLength={4000} defaultValue={source?.description ?? ''} />
      </Field>
      <p className="muted small full">Não escreva informações clínicas aqui: tarefas são administrativas e outras pessoas da equipe podem vê-las.</p>
      <Field label="Responsável">
        <select className="input" name="assignee" required defaultValue={source?.assignee_id ?? defaultAssignee ?? user.id}
          key={assignees ? 'carregado' : 'carregando'}>
          {(assignees ?? loadingAssignees).map((item) => <option key={item.id} value={item.id}>{item.id === user.id ? `${item.name} (eu)` : item.name}</option>)}
        </select>
      </Field>
      <Field label="Prioridade">
        <select className="input" name="priority" defaultValue={source?.priority ?? 'normal'}>
          {PRIORITIES.map((item) => <option key={item} value={item}>{taskPriorityLabel[item]}</option>)}
        </select>
      </Field>
      <Field label={frequency ? 'Primeira vez em' : 'Prazo (opcional)'}>
        <input className="input" name="dueDate" type="date" required={Boolean(frequency)}
          defaultValue={task?.due_date ?? recurrence?.starts_on ?? ''} min={task || recurrence ? undefined : todayKey()} />
      </Field>
      <Field label="Horário (opcional)">
        <input className="input" name="dueTime" type="time" defaultValue={source?.due_time?.slice(0, 5) ?? ''} />
      </Field>
      {!task && (
        <Field label="Repetir">
          <select className="input" name="frequency" value={frequency}
            onChange={(event) => setFrequency(event.target.value as TaskFrequency | '')}>
            {!editingRule && <option value="">Não repete</option>}
            {FREQUENCIES.map((item) => <option key={item} value={item}>{frequencyTaskLabel[item]}</option>)}
          </select>
        </Field>
      )}
      {(patients.length > 0 || source?.patient_id) && (
        <Field label="Paciente (opcional)">
          <select className="input" name="patient" defaultValue={source?.patient_id ?? ''} key={patients.length}>
            <option value="">Nenhum</option>
            {source?.patient_id && !patients.some((item) => item.id === source.patient_id) && (
              <option value={source.patient_id}>{source.patient_name ?? 'Paciente'}</option>
            )}
            {patients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </Field>
      )}
      {frequency && (
        <p className="muted small full">
          Ao concluir, a próxima é criada sozinha na data da regra (ex.: mensal do dia 5 concluída no dia 8 → próxima no dia 5 do mês seguinte).
          {recurrence && ' Mudanças valem para a tarefa em aberto e as próximas.'}
        </p>
      )}
    </FormModal>
  );
}

const EVENT_TEXT: Record<string, (from: string | null, to: string | null) => string> = {
  created: () => 'criou a tarefa',
  edited: () => 'editou a tarefa',
  assigned: (from, to) => `passou de ${from ?? 'ninguém'} para ${to ?? 'ninguém'}`,
  status: (from, to) => `mudou de ${taskStatusLabel[from ?? ''] ?? from} para ${taskStatusLabel[to ?? ''] ?? to}`,
  comment: () => 'comentou'
};

// Detalhe: dados, situação, histórico e comentários.
export function TaskDetail({ user, taskId, onClose, onChanged }: {
  user: SessionUser; taskId: string; onClose: () => void; onChanged: () => void;
}) {
  const notify = useToast();
  const { data, error, reload } = useLoad(() => Promise.all([api.task(taskId), api.taskHistory(taskId)]), [taskId]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const comment = useFormSubmit(async (form) => {
    await api.commentTask(taskId, text(form, 'body'));
    reload();
    onChanged();
  });
  const [task, history] = data ?? [null, []];

  async function setStatus(status: Task['status']) {
    setBusy(true);
    try {
      const next = await api.setTaskStatus(taskId, status);
      notify(status === 'done' ? (next ? 'Concluída. A próxima ocorrência já foi criada.' : 'Tarefa concluída.') : `Tarefa: ${taskStatusLabel[status].toLowerCase()}.`);
      reload();
      onChanged();
    } catch (failure) {
      notify(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  if (editing && task) {
    return <TaskForm user={user} task={task} onClose={() => setEditing(false)} onSaved={() => { reload(); onChanged(); }} />;
  }

  return (
    <Modal title={task?.title ?? 'Tarefa'} onClose={onClose}>
      <div className="modal-body task-detail">
        {!data && <p className={error ? 'erro' : 'muted'} role={error ? 'alert' : undefined}>{error || 'Carregando…'}</p>}
        {data && !task && <p className="muted">Tarefa não encontrada ou fora do seu acesso.</p>}
        {task && <>
          <dl className="facts">
            <dt>Situação</dt><dd><span className={`st task-${task.status}`}>{taskStatusLabel[task.status]}</span>
              {task.completed_at && <span className="sub">por {task.completed_by_name ?? '—'} em {dateTime(task.completed_at)}</span>}</dd>
            <dt>Responsável</dt><dd>{task.assignee_name ?? 'Sem responsável'}</dd>
            <dt>Prazo</dt><dd className={task.overdue ? 'text-danger' : undefined}>{dueLabel(task)}{task.overdue && ' · atrasada'}</dd>
            <dt>Prioridade</dt><dd><span className={`prio prio-${task.priority}`}>{taskPriorityLabel[task.priority]}</span></dd>
            {task.frequency && <><dt>Repete</dt><dd>{frequencyTaskLabel[task.frequency]}</dd></>}
            {task.lead_name && <><dt>Lead</dt><dd><a href={`#/comercial?lead=${task.lead_id}`}>{task.lead_name}</a></dd></>}
            {task.patient_name && <><dt>Paciente</dt><dd><a href={`#/pacientes?id=${task.patient_id}`}>{task.patient_name}</a></dd></>}
            <dt>Criada por</dt><dd>{task.creator_name ?? '—'} em {dateTime(task.created_at)}</dd>
          </dl>
          {task.description && <p className="pre task-description">{task.description}</p>}

          <div className="task-actions">
            {task.status !== 'done' && task.status !== 'cancelled' && <>
              <button type="button" className="button" disabled={busy} onClick={() => setStatus('done')}>Concluir</button>
              {task.status === 'todo' && <button type="button" className="button light" disabled={busy} onClick={() => setStatus('doing')}>Comecei</button>}
            </>}
            {(task.status === 'done' || task.status === 'cancelled') && (
              <button type="button" className="button light" disabled={busy} onClick={() => setStatus('todo')}>Reabrir</button>
            )}
            {task.can_edit && task.status !== 'cancelled' && <button type="button" className="link-btn" onClick={() => setEditing(true)}>Editar</button>}
            {task.can_edit && task.status !== 'cancelled' && task.status !== 'done' && (
              <button type="button" className="link-btn danger" disabled={busy} onClick={() => setStatus('cancelled')}>Cancelar tarefa</button>
            )}
          </div>

          <h3 className="task-section">Histórico</h3>
          <ol className="task-history">
            {history.map((item) => (
              <li key={item.id}>
                <span><b>{item.actor_name ?? 'Sistema'}</b> {(EVENT_TEXT[item.kind] ?? (() => item.kind))(item.from_value, item.to_value)}
                  {item.body && item.kind !== 'comment' && ` (${item.body})`}</span>
                <time className="sub">{dateTime(item.created_at)}</time>
                {item.kind === 'comment' && <p className="pre comment">{item.body}</p>}
              </li>
            ))}
          </ol>
          <form className="task-comment" onSubmit={comment.onSubmit}>
            <label className="sr-only" htmlFor="task-comment">Comentário</label>
            <textarea className="input" id="task-comment" name="body" rows={2} maxLength={2000} required placeholder="Escreva um comentário" />
            {comment.error && <p className="erro" role="alert">{comment.error}</p>}
            <button type="submit" className="button light" disabled={comment.busy}>{comment.busy ? 'Enviando…' : 'Comentar'}</button>
          </form>
        </>}
      </div>
    </Modal>
  );
}

// Lista com check de conclusão. `showAssignee` na visão da equipe e nas criadas por mim.
export function TaskList({ tasks, showAssignee, onOpen, onChanged }: {
  tasks: Task[]; showAssignee: boolean; onOpen: (task: Task) => void; onChanged: () => void;
}) {
  const notify = useToast();
  const [busy, setBusy] = useState('');

  async function toggle(task: Task) {
    setBusy(task.id);
    try {
      const done = task.status !== 'done';
      const next = await api.setTaskStatus(task.id, done ? 'done' : 'todo');
      notify(done ? (next ? 'Concluída. A próxima ocorrência já foi criada.' : 'Tarefa concluída.') : 'Tarefa reaberta.');
      onChanged();
    } catch (failure) {
      notify(errorMessage(failure));
    } finally {
      setBusy('');
    }
  }

  return (
    <ul className="task-list">
      {tasks.map((task) => {
        const closed = task.status === 'done' || task.status === 'cancelled';
        return (
          <li key={task.id} className={closed ? 'task-row closed' : 'task-row'}>
            <input type="checkbox" className="task-check" checked={task.status === 'done'} disabled={busy === task.id || task.status === 'cancelled'}
              aria-label={`${task.status === 'done' ? 'Reabrir' : 'Concluir'}: ${task.title}`} onChange={() => toggle(task)} />
            <button type="button" className="task-main" onClick={() => onOpen(task)}>
              <span className="task-title">{task.title}</span>
              <span className="task-meta">
                <span className={task.overdue ? 'text-danger' : undefined}>{dueLabel(task)}{task.overdue && ' · atrasada'}</span>
                {showAssignee && <span>{task.assignee_name ?? 'Sem responsável'}</span>}
                {task.patient_name && <span>{task.patient_name}</span>}
                {task.frequency && <span>{frequencyTaskLabel[task.frequency]}</span>}
                {task.comments > 0 && <span>{task.comments} {task.comments === 1 ? 'comentário' : 'comentários'}</span>}
                {task.status !== 'todo' && <span className={`task-${task.status}`}>{taskStatusLabel[task.status]}</span>}
              </span>
            </button>
            {task.priority !== 'normal' && <span className={`prio prio-${task.priority}`}>{taskPriorityLabel[task.priority]}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function useTaskParam(initial: string | null) {
  const [open, setOpen] = useState<string | null>(initial);
  return {
    open,
    show: (id: string) => setOpen(id),
    close: () => {
      setOpen(null);
      if (window.location.hash.includes('tarefa=')) history.replaceState(null, '', window.location.hash.replace(/[?&]tarefa=[^&]*/, ''));
    }
  };
}
