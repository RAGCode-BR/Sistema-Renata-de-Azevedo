import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { TaskPriority } from '../../../../shared/types.ts';
import { taskPriorityLabel } from '../../../../shared/format.ts';
import { Button, Field, Screen, State, Tabs } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';
import { message, useLoad } from '../../lib/useLoad';

export default function NewTask() {
  const theme = useTheme();
  const { user } = useAuth();
  const { data: assignees } = useLoad(api.taskAssignees, []);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState(user!.id);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [due, setDue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Screen>
      <Field label="Título" value={title} onChangeText={setTitle} maxLength={200} />
      <Field label="Descrição (opcional, sem informação clínica)" value={description} onChangeText={setDescription} multiline maxLength={4000} />
      <Field label="Prazo (DD/MM/AAAA, opcional)" value={due} onChangeText={setDue} keyboardType="numbers-and-punctuation" placeholder="25/10/2026" />
      <Tabs value={priority} onChange={setPriority} options={(['low', 'normal', 'high', 'urgent'] as TaskPriority[]).map((key) => [key, taskPriorityLabel[key]])} />
      {assignees && assignees.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {assignees.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: assignee === item.id }} onPress={() => setAssignee(item.id)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: assignee === item.id ? theme.primary : theme.soft }}>
              <Text style={{ color: assignee === item.id ? theme.onPrimary : theme.primary, fontSize: 13 }}>{item.id === user!.id ? 'Eu' : item.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <State error={error} />
      <Button label="Criar tarefa" busy={busy} disabled={!title.trim()} onPress={async () => {
        const match = due.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (due.trim() && !match) { setError('Prazo: use DD/MM/AAAA.'); return; }
        setBusy(true); setError('');
        try {
          await api.saveTask(null, { title, description, assigneeId: assignee, priority, patientId: null, dueTime: null,
            dueDate: match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null });
          router.back();
        } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
      }} />
    </Screen>
  );
}
