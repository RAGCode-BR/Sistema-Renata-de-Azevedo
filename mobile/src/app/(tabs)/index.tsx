import { router } from 'expo-router';
import { View } from 'react-native';
import { can } from '../../../../shared/permissions.ts';
import { occupiesSlot } from '../../../../shared/types.ts';
import { addDays, money, plural, relativeDay, startOfToday, time } from '../../../../shared/format.ts';
import { Card, Muted, Row, Screen, Stat, State, Title } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/supabase';
import { useLoad, useReloadOnFocus } from '../../lib/useLoad';

// Início: sessões de hoje, próxima sessão e pendências (presença, evolução, tarefas, cobranças).
export default function Home() {
  const { user } = useAuth();
  const overview = can(user!, 'appointments.view_all');
  const own = user!.roles.includes('professional') ? user!.professional_id : null;
  const { data, error, loading, reload } = useLoad(() => {
    const today = startOfToday();
    return Promise.all([
      api.appointments(today, addDays(today, 7)),
      api.pendingNotes(),
      api.unrecordedAttendance(addDays(today, -60)),
      api.tasks('mine', true),
      can(user!, 'billing.view') ? api.receivables() : Promise.resolve(null)
    ]);
  }, [user]);
  useReloadOnFocus(reload);
  const [appointments = [], pending = [], unrecorded = [], tasks = [], receivables = null] = data ?? [];
  const tomorrow = addDays(startOfToday(), 1);
  const scheduled = appointments.filter((item) => occupiesSlot(item.status) && (overview || item.professional_id === own));
  const today = scheduled.filter((item) => new Date(item.starts_at) < tomorrow);
  const next = scheduled.find((item) => new Date(item.ends_at).getTime() > Date.now());
  const myPending = pending.filter((item) => !own || item.professional_id === own);
  const myUnrecorded = unrecorded.filter((item) => overview || item.professional_id === own);
  const urgent = tasks.filter((task) => task.overdue || task.due_date === new Date().toISOString().slice(0, 10));

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Title sub={new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}>Olá, {user!.name.split(' ')[0]}</Title>
      <State error={error} loading={!data && loading} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <Stat value={data ? String(today.length) : '–'} label={overview ? 'sessões hoje na clínica' : 'sessões suas hoje'} />
        <Stat value={data ? String(myPending.length) : '–'} label="evoluções pendentes" />
        <Stat value={data ? String(tasks.length) : '–'} label="tarefas em aberto" />
        {receivables && <Stat value={money(receivables.overdue_amount)} label={`vencido em ${plural(receivables.overdue_count, 'cobrança', 'cobranças')}`} tone={receivables.overdue_count ? 'danger' : undefined} />}
      </View>
      {next && (
        <Card title="Próxima sessão">
          <Row title={next.patient_name} detail={`${relativeDay(next.starts_at)} às ${time(next.starts_at)}${overview ? ` · ${next.professional_name}` : ''}`}
            right={next.meeting_url ? 'on-line' : undefined} onPress={() => router.push(`/sessao/${next.id}`)} />
        </Card>
      )}
      <Card title="Pendências">
        {data && !myUnrecorded.length && !myPending.length && !urgent.length && <Muted>Nada pendente. Tudo em dia.</Muted>}
        {myUnrecorded.slice(0, 5).map((item) => (
          <Row key={item.id} title={`Registrar presença: ${item.patient_name}`} detail={`Sessão de ${relativeDay(item.starts_at)} às ${time(item.starts_at)}`}
            tone="warning" onPress={() => router.push(`/sessao/${item.id}`)} />
        ))}
        {myPending.filter((item) => item.professional_id === own).slice(0, 5).map((item) => (
          <Row key={item.appointment_id} title={`${item.note_status === 'draft' ? 'Continuar' : 'Escrever'} evolução: ${item.patient_name}`}
            detail={`Sessão de ${relativeDay(item.starts_at)}${item.overdue ? ' · fora do prazo' : ''}`} tone={item.overdue ? 'danger' : undefined}
            onPress={() => router.push(`/evolucao/${item.appointment_id}?paciente=${item.patient_id}`)} />
        ))}
        {urgent.slice(0, 5).map((task) => (
          <Row key={task.id} title={task.title} detail={task.overdue ? 'Tarefa atrasada' : 'Tarefa para hoje'} tone={task.overdue ? 'danger' : undefined}
            onPress={() => router.push(`/tarefa/${task.id}`)} />
        ))}
        {receivables && receivables.overdue_count > 0 && (
          <Row title={`${plural(receivables.overdue_count, 'cobrança vencida', 'cobranças vencidas')}`} detail={money(receivables.overdue_amount)} tone="danger"
            onPress={() => router.push('/cobrancas')} />
        )}
      </Card>
    </Screen>
  );
}
