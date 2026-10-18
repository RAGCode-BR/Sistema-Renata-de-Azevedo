import { useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionUser, Task, TaskRecurrence, TaskScope } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dayLabel, frequencyTaskLabel, plural, taskPriorityLabel } from '../../format.ts';
import { errorMessage, useLoad } from '../../hooks.ts';
import { TaskDetail, TaskForm, TaskList, useTaskParam } from './shared.tsx';

type Show = 'open' | 'all';

function filterTasks(tasks: Task[], show: Show, search: string) {
  const term = search.trim().toLowerCase();
  return tasks.filter((task) => (show === 'all' || task.status === 'todo' || task.status === 'doing')
    && (!term || task.title.toLowerCase().includes(term)));
}

function Filters({ show, setShow, search, setSearch, children }: {
  show: Show; setShow: (value: Show) => void; search: string; setSearch: (value: string) => void; children?: ReactNode;
}) {
  return (
    <div className="finance-toolbar">
      <div className="tabs" role="tablist" aria-label="Situação">
        <button type="button" role="tab" aria-selected={show === 'open'} className={show === 'open' ? 'tab on' : 'tab'} onClick={() => setShow('open')}>Em aberto</button>
        <button type="button" role="tab" aria-selected={show === 'all'} className={show === 'all' ? 'tab on' : 'tab'} onClick={() => setShow('all')}>Com concluídas (60 dias)</button>
      </div>
      {children}
      <label className="search">
        <input type="search" placeholder="Buscar tarefa" aria-label="Buscar tarefa" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
    </div>
  );
}

// Minhas tarefas: recebidas e criadas por mim.
export function TasksPage({ user, taskId }: { user: SessionUser; taskId: string | null }) {
  const [scope, setScope] = useState<Extract<TaskScope, 'mine' | 'created'>>('mine');
  const [show, setShow] = useState<Show>('open');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const detail = useTaskParam(taskId);
  const { data, error, reload } = useLoad(() => api.tasks(scope, show === 'open'), [scope, show]);
  const tasks = filterTasks(data ?? [], show, search);
  const overdue = (data ?? []).filter((task) => task.overdue).length;

  return (
    <>
      <Heading title="Minhas tarefas" lead={data ? `${plural(tasks.filter((t) => t.status === 'todo' || t.status === 'doing').length, 'tarefa em aberto', 'tarefas em aberto')}${overdue ? `, ${plural(overdue, 'atrasada', 'atrasadas')}` : ''}.` : undefined}>
        <button type="button" className="button" onClick={() => setCreating(true)}>Nova tarefa</button>
      </Heading>
      <div className="tabs spaced-tabs" role="tablist" aria-label="Tarefas">
        <button type="button" role="tab" aria-selected={scope === 'mine'} className={scope === 'mine' ? 'tab on' : 'tab'} onClick={() => setScope('mine')}>Para mim</button>
        <button type="button" role="tab" aria-selected={scope === 'created'} className={scope === 'created' ? 'tab on' : 'tab'} onClick={() => setScope('created')}>Criadas por mim</button>
      </div>
      <Filters show={show} setShow={setShow} search={search} setSearch={setSearch} />
      <Panel title={scope === 'mine' ? 'Para mim' : 'Criadas por mim'}>
        {tasks.length ? <TaskList tasks={tasks} showAssignee={scope === 'created'} onOpen={(task) => detail.show(task.id)} onChanged={reload} />
          : <PanelState error={error} loading={!data} empty={scope === 'mine' ? 'Nenhuma tarefa para você. Tudo em dia.' : 'Você não criou tarefas.'} />}
      </Panel>
      {creating && <TaskForm user={user} onClose={() => setCreating(false)} onSaved={reload} />}
      {detail.open && <TaskDetail user={user} taskId={detail.open} onClose={detail.close} onChanged={reload} />}
    </>
  );
}

// Tarefas da equipe (tasks.manage): todas, com filtro por responsável e resumo por pessoa.
export function TeamTasksPage({ user }: { user: SessionUser }) {
  const [show, setShow] = useState<Show>('open');
  const [search, setSearch] = useState('');
  const [assignee, setAssignee] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [creating, setCreating] = useState(false);
  const detail = useTaskParam(null);
  const { data, error, reload } = useLoad(() => api.tasks('team', show === 'open'), [show]);
  const all = data ?? [];
  const people = new Map<string, { name: string; open: number; overdue: number }>();
  for (const task of all) {
    if (task.status !== 'todo' && task.status !== 'doing') continue;
    const key = task.assignee_id ?? '';
    const person = people.get(key) ?? { name: task.assignee_name ?? 'Sem responsável', open: 0, overdue: 0 };
    person.open += 1;
    if (task.overdue) person.overdue += 1;
    people.set(key, person);
  }
  const tasks = filterTasks(all, show, search)
    .filter((task) => (!assignee || (task.assignee_id ?? '') === assignee) && (!onlyOverdue || task.overdue));

  return (
    <>
      <Heading title="Tarefas da equipe" lead="Acompanhamento das tarefas de todas as pessoas.">
        <button type="button" className="button" onClick={() => setCreating(true)}>Nova tarefa</button>
      </Heading>
      {people.size > 0 && (
        <section className="numbers" aria-label="Por pessoa">
          {[...people.entries()].sort((a, b) => b[1].overdue - a[1].overdue || a[1].name.localeCompare(b[1].name)).map(([id, person]) => (
            <button key={id} type="button" className={assignee === id ? 'number selected' : 'number'} aria-pressed={assignee === id}
              onClick={() => setAssignee(assignee === id ? '' : id)}>
              <strong>{person.open}</strong>
              <span>{person.name}{person.overdue > 0 && <>, <b className="text-danger">{person.overdue} {person.overdue === 1 ? 'atrasada' : 'atrasadas'}</b></>}</span>
            </button>
          ))}
        </section>
      )}
      <Filters show={show} setShow={setShow} search={search} setSearch={setSearch}>
        <label className="field-inline">Responsável
          <select className="input compact" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">Todas as pessoas</option>
            {[...people.entries()].map(([id, person]) => <option key={id} value={id}>{person.name}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={onlyOverdue} onChange={(event) => setOnlyOverdue(event.target.checked)} /><span>Só atrasadas</span></label>
      </Filters>
      <Panel title="Tarefas" tools={tasks.length ? <span className="muted small">{plural(tasks.length, 'tarefa', 'tarefas')}</span> : undefined}>
        {tasks.length ? <TaskList tasks={tasks} showAssignee onOpen={(task) => detail.show(task.id)} onChanged={reload} />
          : <PanelState error={error} loading={!data} empty="Nenhuma tarefa com esses filtros." />}
      </Panel>
      {creating && <TaskForm user={user} defaultAssignee={assignee || undefined} onClose={() => setCreating(false)} onSaved={reload} />}
      {detail.open && <TaskDetail user={user} taskId={detail.open} onClose={detail.close} onChanged={reload} />}
    </>
  );
}

// Regras de tarefas recorrentes.
export function RecurrencesPage({ user }: { user: SessionUser }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(api.recurrences, []);
  const [editing, setEditing] = useState<TaskRecurrence | 'new' | null>(null);
  const [busy, setBusy] = useState('');
  const rules = data ?? [];

  async function toggle(rule: TaskRecurrence) {
    setBusy(rule.id);
    try {
      await api.setRecurrenceActive(rule.id, !rule.active);
      notify(rule.active ? 'Tarefa recorrente pausada.' : 'Tarefa recorrente retomada.');
      reload();
    } catch (failure) {
      notify(errorMessage(failure));
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <Heading title="Tarefas recorrentes" lead="Regras que criam a próxima tarefa sozinhas quando a atual é concluída.">
        <button type="button" className="button" onClick={() => setEditing('new')}>Nova tarefa recorrente</button>
      </Heading>
      <Panel title="Regras">
        {rules.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Tarefa</th><th>Responsável</th><th>Repete</th><th>Próxima</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>{rule.title}{rule.priority !== 'normal' && <span className="sub">Prioridade {taskPriorityLabel[rule.priority].toLowerCase()}</span>}</td>
                    <td>{rule.assignee_name ?? 'Sem responsável'}</td>
                    <td>{frequencyTaskLabel[rule.frequency]}{rule.due_time && <span className="sub">às {rule.due_time.slice(0, 5)}</span>}</td>
                    <td className="num-left">{rule.next_due ? dayLabel(rule.next_due) : '—'}</td>
                    <td>{rule.active ? 'Ativa' : 'Pausada'}</td>
                    <td className="actions-cell">
                      {rule.can_edit && <>
                        <button type="button" className="link-btn" onClick={() => setEditing(rule)}>Editar</button>
                        <button type="button" className="link-btn" disabled={busy === rule.id} onClick={() => toggle(rule)}>{rule.active ? 'Pausar' : 'Retomar'}</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhuma tarefa recorrente." />}
      </Panel>
      <p className="muted small">Pausar mantém a tarefa que já está em aberto; retomar cria a próxima, se não houver uma em aberto.</p>
      {editing && (
        <TaskForm user={user} recurrence={editing === 'new' ? undefined : editing} recurring onClose={() => setEditing(null)} onSaved={reload} />
      )}
    </>
  );
}
