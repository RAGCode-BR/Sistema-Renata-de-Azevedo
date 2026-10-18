import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { can } from '../../../../shared/permissions.ts';
import type { Task } from '../../../../shared/types.ts';
import { dayLabel } from '../../../../shared/format.ts';
import { Button, Card, Screen, State, Tabs } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';
import { message, useLoad, useReloadOnFocus } from '../../lib/useLoad';

type Scope = 'mine' | 'team';

// Tarefas: as minhas e, para quem acompanha a equipe, as de todos. O check conclui.
export default function TasksScreen() {
  const { user } = useAuth();
  const team = can(user!, 'tasks.manage');
  const [scope, setScope] = useState<Scope>('mine');
  const { data, error, loading, reload } = useLoad(() => api.tasks(scope, true), [scope]);
  useReloadOnFocus(reload);
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      {team && <Tabs value={scope} onChange={setScope} options={[['mine', 'Para mim'], ['team', 'Equipe']]} />}
      <State error={error} loading={!data && loading} empty={data && !data.length ? 'Nenhuma tarefa em aberto. Tudo em dia.' : undefined} />
      {data && data.length > 0 && <Card>{data.map((task) => <TaskRow key={task.id} task={task} showAssignee={scope === 'team'} onChanged={reload} />)}</Card>}
      <Button label="Nova tarefa" onPress={() => router.push('/tarefa/nova')} />
    </Screen>
  );
}

export function TaskRow({ task, showAssignee, onChanged }: { task: Task; showAssignee?: boolean; onChanged: () => void }) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const done = task.status === 'done';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 0.5, borderColor: theme.border }}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done, disabled: busy }} accessibilityLabel={`${done ? 'Reabrir' : 'Concluir'}: ${task.title}`}
        disabled={busy} hitSlop={10} onPress={async () => {
          setBusy(true);
          try {
            const next = await api.setTaskStatus(task.id, done ? 'todo' : 'done');
            if (!done && next) Alert.alert('Concluída', 'A próxima ocorrência já foi criada.');
            onChanged();
          } catch (failure) { Alert.alert('Não foi possível', message(failure)); } finally { setBusy(false); }
        }}
        style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: theme.primary, backgroundColor: done ? theme.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {done ? <Text style={{ color: theme.onPrimary, fontSize: 14 }}>✓</Text> : null}
      </Pressable>
      <Pressable style={{ flex: 1 }} accessibilityRole="button" onPress={() => router.push(`/tarefa/${task.id}`)}>
        <Text style={{ color: theme.text, fontSize: 15, textDecorationLine: done ? 'line-through' : 'none' }}>{task.title}</Text>
        <Text style={{ color: task.overdue ? theme.danger : theme.muted, fontSize: 13 }}>
          {[task.due_date ? `${dayLabel(task.due_date)}${task.due_time ? ` ${task.due_time.slice(0, 5)}` : ''}` : 'Sem prazo', task.overdue && 'atrasada',
            showAssignee && task.assignee_name, task.priority === 'urgent' ? 'urgente' : task.priority === 'high' ? 'alta' : null].filter(Boolean).join(' · ')}
        </Text>
      </Pressable>
    </View>
  );
}
