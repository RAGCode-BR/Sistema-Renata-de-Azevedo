import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { dateTime, dayLabel, frequencyTaskLabel, taskPriorityLabel, taskStatusLabel } from '../../../../shared/format.ts';
import { Button, Card, Field, Muted, Row, Screen, State, Title } from '../../components/ui';
import { api } from '../../lib/supabase';
import { message, useLoad } from '../../lib/useLoad';

const EVENT: Record<string, string> = { created: 'criou a tarefa', edited: 'editou', assigned: 'mudou o responsável', status: 'mudou a situação', comment: 'comentou' };

export default function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.task(id), api.taskHistory(id)]), [id]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState('');
  if (!data?.[0]) return <Screen><State error={error || (data ? 'Tarefa não encontrada.' : '')} loading={loading} /></Screen>;
  const [task, history] = data;
  const open = task.status === 'todo' || task.status === 'doing';
  async function act(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try { await action(); reload(); } catch (failure) { Alert.alert('Não foi possível', message(failure)); } finally { setBusy(''); }
  }
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Title sub={taskStatusLabel[task.status]}>{task.title}</Title>
      <Card>
        <Row title="Responsável" right={task.assignee_name ?? '—'} />
        <Row title="Prazo" right={task.due_date ? `${dayLabel(task.due_date)}${task.due_time ? ` às ${task.due_time.slice(0, 5)}` : ''}${task.overdue ? ' (atrasada)' : ''}` : 'Sem prazo'}
          tone={task.overdue ? 'danger' : undefined} />
        <Row title="Prioridade" right={taskPriorityLabel[task.priority]} />
        {task.frequency && <Row title="Repete" right={frequencyTaskLabel[task.frequency]} />}
        {task.patient_name && <Row title="Paciente" right={task.patient_name} />}
        {task.description ? <Row title="Descrição" detail={task.description} /> : null}
      </Card>
      {open
        ? <Button label="Concluir" busy={busy === 'done'} onPress={() => act('done', () => api.setTaskStatus(task.id, 'done'))} />
        : <Button label="Reabrir" variant="light" busy={busy === 'todo'} onPress={() => act('todo', () => api.setTaskStatus(task.id, 'todo'))} />}
      <Card title="Histórico">
        {history.map((item) => <Row key={item.id} title={`${item.actor_name ?? 'Sistema'} ${EVENT[item.kind] ?? item.kind}`} detail={[item.body, dateTime(item.created_at)].filter(Boolean).join('\n')} />)}
        <Field label="Comentário" value={comment} onChangeText={setComment} multiline maxLength={2000} />
        <Button label="Comentar" variant="light" busy={busy === 'comment'} disabled={!comment.trim()}
          onPress={() => act('comment', async () => { await api.commentTask(task.id, comment); setComment(''); })} />
      </Card>
      <Muted>Edição completa e tarefas recorrentes ficam no sistema web.</Muted>
    </Screen>
  );
}
