import { useMemo } from 'react';
import { can } from '../../../shared/permissions.ts';
import { occupiesSlot } from '../../../shared/types.ts';
import type { Appointment, PendingNote, SessionUser, Task } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { addDays, dateKey, longDay, modalityLabel, money, plural, relativeDay, startOfToday, statusLabel, time } from '../format.ts';
import { useLoad } from '../hooks.ts';

// Painel inicial. Mostra só dados reais e só o que cada perfil pode ver (as consultas passam pelo RLS):
// - quem vê a agenda geral (Proprietário(a), Gerente, Recepção): a clínica toda e as pendências de
//   evolução por profissional, sem o conteúdo dos prontuários;
// - profissional: a própria agenda e as próprias evoluções pendentes, com atalho para o prontuário.
// Uma pessoa com os dois papéis (ex.: Renata) vê a clínica e também a própria lista de pendências.
export function HomePage({ user }: { user: SessionUser }) {
  const overview = can(user, 'appointments.view_all');
  const billing = can(user, 'billing.view');
  const crm = can(user, 'crm.view');
  const ownProfessional = user.roles.includes('professional') ? user.professional_id : null;
  const range = useMemo(() => {
    const today = startOfToday();
    return { today, tomorrow: addDays(today, 1), week: addDays(today, 7) };
  }, []);
  const { data, error } = useLoad(() => Promise.all([
    api.appointments(range.today, range.week),
    api.pendingNotes(),
    api.activePatientsCount(),
    overview ? api.activeProfessionalsCount() : Promise.resolve(null),
    api.unrecordedAttendance(addDays(range.today, -60)),
    billing ? api.receivables() : Promise.resolve(null),
    api.tasks('mine', true),
    api.taskCounts(),
    crm ? api.crmSummary(dateKey(new Date(range.today.getFullYear(), range.today.getMonth(), 1)), dateKey(range.today)) : Promise.resolve(null)
  ]), [range, overview, billing, crm]);

  const lead = capitalize(longDay(range.today.toISOString()));

  const [appointments, pending, patientsCount, professionalsCount, unrecorded, receivables, myTasks, taskCounts, commercial] =
    data ?? [[], [], 0, null, [], null, [], null, null];
  const urgentTasks = myTasks.filter((task) => task.overdue || task.due_date === dateKey(range.today));

  if (!overview && !ownProfessional) {
    return (
      <>
        <Heading title={`Olá, ${firstName(user.name)}`} lead={lead} />
        <section className="numbers" aria-label="Resumo" aria-busy={!data}>
          <a className="number" href="#/tarefas"><strong>{data ? myTasks.length : '–'}</strong><span>tarefas suas em aberto</span></a>
          <a className="number" href="#/tarefas"><strong className={taskCounts?.overdue ? 'text-danger' : undefined}>{data ? taskCounts?.overdue ?? 0 : '–'}</strong><span>atrasadas</span></a>
          {billing && receivables && <a className="number" href="#/cobrancas"><strong>{money(receivables.overdue_amount)}</strong><span>em cobranças vencidas</span></a>}
        </section>
        <Pendencies overview={false} ownProfessional={null} pending={[]} myPending={[]} unrecorded={[]} myUnrecorded={[]}
          overdueCharges={receivables?.overdue_count ?? 0} overdueAmount={receivables?.overdue_amount ?? 0} tasks={urgentTasks} loaded={Boolean(data)} />
      </>
    );
  }

  const scheduled = appointments.filter((item) => occupiesSlot(item.status));
  const today = scheduled.filter((item) => new Date(item.starts_at) < range.tomorrow);
  const mine = ownProfessional ? scheduled.filter((item) => item.professional_id === ownProfessional) : [];
  const myPending = ownProfessional ? pending.filter((item) => item.professional_id === ownProfessional) : [];
  const myUnrecorded = ownProfessional ? unrecorded.filter((item) => item.professional_id === ownProfessional) : [];
  const now = Date.now();
  const next = (ownProfessional ? mine : scheduled).find((item) => new Date(item.ends_at).getTime() > now);

  return (
    <>
      <Heading title={`Olá, ${firstName(user.name)}`} lead={lead}>
        {can(user, 'appointments.manage') && <a className="button" href="#/agenda">Agendar sessão</a>}
      </Heading>

      {error && <p className="notice erro" role="alert">{error}</p>}

      <section className="numbers" aria-label="Resumo" aria-busy={!data}>
        <a className="number" href="#/agenda">
          <strong>{data ? today.length : '–'}</strong>
          <span>{overview ? 'sessões hoje na clínica' : 'sessões suas hoje'}</span>
        </a>
        <a className="number" href="#/agenda">
          <strong>{data ? (overview ? scheduled : mine).length : '–'}</strong>
          <span>nos próximos 7 dias</span>
        </a>
        <a className="number" href="#/pacientes">
          <strong>{data ? patientsCount : '–'}</strong>
          <span>{overview ? 'pacientes ativos' : 'pacientes seus'}</span>
        </a>
        {overview && (
          <a className="number" href="#/profissionais">
            <strong>{data ? professionalsCount : '–'}</strong>
            <span>profissionais em atividade</span>
          </a>
        )}
        {commercial && (
          <a className="number" href="#/comercial-painel">
            <strong>{commercial.new_patients}</strong>
            <span>novos pacientes no mês{commercial.leads > 0 && `, ${Math.round((commercial.converted / commercial.leads) * 100)}% dos ${commercial.leads} leads convertidos`}</span>
          </a>
        )}
        <a className="number" href={taskCounts?.team_overdue != null ? '#/tarefas-equipe' : '#/tarefas'}>
          <strong className={(taskCounts?.team_overdue ?? taskCounts?.overdue) ? 'text-danger' : undefined}>
            {data ? taskCounts?.team_overdue ?? taskCounts?.overdue ?? 0 : '–'}
          </strong>
          <span>{taskCounts?.team_overdue != null ? 'tarefas atrasadas na equipe' : 'tarefas suas atrasadas'}</span>
        </a>
        <a className="number" href={ownProfessional ? '#/prontuarios' : '#/agenda'}>
          <strong>{data ? (overview ? pending : myPending).length : '–'}</strong>
          <span>{overview ? 'evoluções pendentes na clínica' : 'evoluções suas pendentes'}</span>
        </a>
      </section>

      <div className="content">
        <Panel title="Sessões de hoje">
          {today.length ? <TodayTable appointments={today} showProfessional={overview} /> :
            <PanelState error={error} loading={!data} empty="Nenhuma sessão hoje." />}
        </Panel>

        <aside className="side">
          <section className="next" aria-label="Próxima sessão">
            {next ? (
              <>
                <div className="next-when">
                  {ownProfessional ? 'Sua próxima sessão' : 'Próxima sessão'}, {relativeDay(next.starts_at)} às <b>{time(next.starts_at)}</b>
                </div>
                <h3>{next.patient_name}</h3>
                <p>{overview && !ownProfessional ? `Com ${next.professional_name}, ` : ''}{modalityLabel[next.modality].toLowerCase()}, {statusLabel[next.status].toLowerCase()}</p>
                <div className="next-actions">
                  {ownProfessional
                    ? <a className="button light" href={`#/prontuarios?paciente=${next.patient_id}`}>Abrir prontuário</a>
                    : <a className="button light" href="#/agenda">Ver agenda</a>}
                </div>
              </>
            ) : <p>{data ? 'Nenhuma sessão nos próximos 7 dias.' : 'Carregando…'}</p>}
          </section>

          <Pendencies overview={overview} ownProfessional={ownProfessional} pending={pending} myPending={myPending}
            unrecorded={unrecorded} myUnrecorded={myUnrecorded} overdueCharges={receivables?.overdue_count ?? 0}
            overdueAmount={receivables?.overdue_amount ?? 0} tasks={urgentTasks} loaded={Boolean(data)} />
        </aside>
      </div>
    </>
  );
}

function TodayTable({ appointments, showProfessional }: { appointments: Appointment[]; showProfessional: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Horário</th><th>Paciente</th>{showProfessional && <th>Profissional</th>}<th>Modalidade</th><th>Situação</th></tr>
        </thead>
        <tbody>
          {appointments.map((item) => (
            <tr key={item.id}>
              <td className="num-left">{time(item.starts_at)}–{time(item.ends_at)}</td>
              <td>{item.patient_name}</td>
              {showProfessional && <td>{item.professional_name}</td>}
              <td>{modalityLabel[item.modality]}</td>
              <td><span className={`st st-${item.status}`}>{statusLabel[item.status]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SHOWN = 5;

interface PendenciesProps {
  overview: boolean;
  ownProfessional: string | null;
  pending: PendingNote[];
  myPending: PendingNote[];
  unrecorded: Appointment[];
  myUnrecorded: Appointment[];
  overdueCharges: number;
  overdueAmount: number;
  tasks: Task[];
  loaded: boolean;
}

// Presença não registrada: sessão que já terminou e continua "agendada/confirmada".
// Profissional: cada pendência vira um atalho (presença na agenda; evolução no prontuário).
// Gerência: quantas pendências cada profissional tem e desde quando, sem abrir prontuários.
function Pendencies({ overview, ownProfessional, pending, myPending, unrecorded, myUnrecorded, overdueCharges, overdueAmount, tasks, loaded }: PendenciesProps) {
  const notOwn = <T extends { professional_id: string }>(items: T[]) => items.filter((item) => item.professional_id !== ownProfessional);
  const otherNotes = overview ? byProfessional(notOwn(pending)) : [];
  const otherAttendance = overview ? byProfessional(notOwn(unrecorded)) : [];
  const count = myPending.length + myUnrecorded.length + overdueCharges + tasks.length
    + [...otherNotes, ...otherAttendance].reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="todo" aria-label="Pendências">
      <h2>Pendências{count > 0 && <small>{count}</small>}</h2>
      {!loaded && <p className="muted small">Carregando…</p>}
      {loaded && !count && <p className="muted small">Nada pendente. Tudo em dia.</p>}

      {tasks.slice(0, SHOWN).map((task) => (
        <a key={task.id} className="task" href={`#/tarefas?tarefa=${task.id}`}>
          <span className="dot" aria-hidden="true" />
          <span>{task.title}<p>{task.overdue ? 'Tarefa atrasada' : 'Tarefa para hoje'}{task.due_time ? ` · ${task.due_time.slice(0, 5)}` : ''}</p></span>
        </a>
      ))}
      {tasks.length > SHOWN && (
        <a className="task" href="#/tarefas">
          <span className="dot" aria-hidden="true" />
          <span>Mais {plural(tasks.length - SHOWN, 'tarefa', 'tarefas')} para hoje ou atrasadas<p>Abrir minhas tarefas</p></span>
        </a>
      )}

      {overdueCharges > 0 && (
        <a className="task" href="#/cobrancas">
          <span className="dot" aria-hidden="true" />
          <span>{plural(overdueCharges, 'cobrança vencida', 'cobranças vencidas')}<p>{money(overdueAmount)} a receber em atraso</p></span>
        </a>
      )}

      {myUnrecorded.slice(0, SHOWN).map((item) => (
        <a key={item.id} className="task" href={`#/agenda?data=${dateKey(new Date(item.starts_at))}&sessao=${item.id}`}>
          <span className="dot" aria-hidden="true" />
          <span>Registrar presença de {item.patient_name}<p>Sessão de {relativeDay(item.starts_at)} às {time(item.starts_at)}. Veio ou faltou?</p></span>
        </a>
      ))}
      {otherAttendance.map((item) => (
        <a key={`presenca-${item.professionalId}`} className="task" href={`#/agenda?data=${dateKey(new Date(item.oldest))}`}>
          <span className="dot" aria-hidden="true" />
          <span>{plural(item.count, 'sessão sem presença registrada', 'sessões sem presença registrada')} de {item.name}<p>A mais antiga é de {relativeDay(item.oldest)}</p></span>
        </a>
      ))}

      {myPending.slice(0, SHOWN).map((item) => (
        <a key={item.appointment_id} className="task" href={`#/prontuarios?paciente=${item.patient_id}&sessao=${item.appointment_id}`}>
          <span className="dot" aria-hidden="true" />
          <span>
            {item.note_status === 'draft' ? 'Finalizar rascunho de' : 'Registrar evolução de'} {item.patient_name}
            <p>Sessão de {relativeDay(item.starts_at)} às {time(item.starts_at)}{item.overdue ? ' · fora do prazo' : ''}</p>
          </span>
        </a>
      ))}
      {myPending.length > SHOWN && (
        <a className="task" href="#/prontuarios">
          <span className="dot" aria-hidden="true" />
          <span>Mais {plural(myPending.length - SHOWN, 'evolução pendente', 'evoluções pendentes')}<p>Abrir prontuários</p></span>
        </a>
      )}

      {otherNotes.map((item) => (
        <div key={item.professionalId} className="task">
          <span className="dot" aria-hidden="true" />
          <span>{plural(item.count, 'evolução pendente', 'evoluções pendentes')} de {item.name}<p>A mais antiga é de {relativeDay(item.oldest)}</p></span>
        </div>
      ))}
    </section>
  );
}

function byProfessional(pending: { professional_id: string; professional_name: string; starts_at: string }[]) {
  const groups = new Map<string, { professionalId: string; name: string; count: number; oldest: string }>();
  for (const item of pending) {
    const group = groups.get(item.professional_id);
    if (group) group.count += 1;
    else groups.set(item.professional_id, { professionalId: item.professional_id, name: item.professional_name, count: 1, oldest: item.starts_at });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function firstName(name: string): string {
  return name.split(' ')[0] ?? name;
}
