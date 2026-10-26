import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import type { PatientActivity } from '../../../shared/types.ts';
import { dayLabel } from '../../../shared/format.ts';
import { Button, Card, Field, Muted, Row, Screen, State, Tabs, Title } from './ui';
import { api } from '../lib/supabase';
import { useTheme } from '../lib/theme';
import { message, useLoad, useReloadOnFocus } from '../lib/useLoad';

export function PatientActivitiesScreen({ isOwner = false }: { isOwner?: boolean }) {
  const theme = useTheme();
  const { data, error, loading, reload } = useLoad(api.patientActivities, []);
  const { data: patients } = useLoad(api.patientActivityPatients, []);
  useReloadOnFocus(reload);
  const [show, setShow] = useState<'assigned' | 'completed'>('assigned');
  const [creating, setCreating] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const { data: professionals } = useLoad(() => !isOwner ? Promise.resolve([])
    : patientId ? api.patientActivityProfessionals(patientId)
      : api.professionals().then((items) => items.filter((item) => item.active).map(({ id, name }) => ({ id, name }))),
    [isOwner, patientId]);
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [checklist, setChecklist] = useState<string[]>([]);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const items = (data ?? []).filter((item) => item.status === show);

  async function create() {
    const match = due.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (due.trim() && !match) { Alert.alert('Prazo', 'Use DD/MM/AAAA.'); return; }
    if (!patientId || (isOwner && !professionalId) || !title.trim() || !instructions.trim()) { Alert.alert('Preencha os campos', 'Escolha o paciente, a profissional responsável, o título e as orientações.'); return; }
    if (checklist.some((item) => !item.trim())) { Alert.alert('Checklist', 'Preencha ou remova os itens vazios.'); return; }
    setBusy(true);
    try {
      await api.savePatientActivity(null, patientId, title, instructions,
        match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null,
        isOwner ? professionalId : null, checklist.map((text) => ({ text: text.trim() })));
      setCreating(false); setPatientId(''); setProfessionalId(''); setTitle(''); setInstructions(''); setChecklist([]); setDue(''); reload();
      Alert.alert('Enviada', 'A tarefa está no portal do paciente.');
    } catch (failure) { Alert.alert('Não foi possível', message(failure)); }
    finally { setBusy(false); }
  }

  return <Screen refreshing={loading} onRefresh={reload}>
    <Title sub={isOwner ? 'Tarefas enviadas aos pacientes da clínica' : 'Tarefas que você passou aos seus pacientes'}>Tarefas</Title>
    <Tabs value={show} onChange={setShow} options={[["assigned", "Em aberto"], ["completed", "Concluídas"]]} />
    <State error={error} loading={!data && loading} empty={data && !items.length ? 'Nenhuma tarefa nesta situação.' : undefined} />
    {items.map((item: PatientActivity) => <Card key={item.id} title={item.title}>
      <Row title={item.patient_name} detail={`${isOwner ? `${item.professional_name} · ` : ''}${item.due_date ? `Até ${dayLabel(item.due_date)}` : 'Sem prazo'}`} />
      <Muted>{item.instructions}</Muted>
      {item.checklist?.length > 0 && <>
        <Muted>Checklist: {item.checklist.filter((entry) => entry.completed_at).length}/{item.checklist.length} concluídos</Muted>
        {item.checklist.map((entry) => <Text key={entry.id} style={{ color: theme.muted, marginBottom: 4 }}>
          {entry.completed_at ? '✓' : '○'} {entry.text}
        </Text>)}
      </>}
      {item.patient_response && <Row title="Resposta do paciente" detail={item.patient_response} />}
      {item.status === 'assigned' && <Button label="Cancelar tarefa" variant="light" onPress={() =>
        Alert.alert('Cancelar tarefa?', item.title, [{ text: 'Voltar' }, { text: 'Cancelar tarefa', style: 'destructive', onPress: async () => {
          try { await api.cancelPatientActivity(item.id); reload(); } catch (failure) { Alert.alert('Não foi possível', message(failure)); }
        } }])} />}
    </Card>)}
    {!creating ? <Button label="Nova tarefa para paciente" onPress={() => setCreating(true)} /> : <Card title="Nova tarefa para paciente">
      <Text style={{ color: theme.muted, marginBottom: 8 }}>Paciente</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {(patients ?? []).map((patient) => <Pressable key={patient.id} accessibilityRole="button" accessibilityState={{ selected: patientId === patient.id }}
          onPress={() => { setPatientId(patient.id); setProfessionalId(''); }} style={{ padding: 8, borderRadius: 8, backgroundColor: patientId === patient.id ? theme.primary : theme.soft }}>
          <Text style={{ color: patientId === patient.id ? theme.onPrimary : theme.primary }}>{patient.name}</Text>
        </Pressable>)}
      </View>
      {isOwner && <>
        <Text style={{ color: theme.muted, marginBottom: 8 }}>Profissional responsável</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {(professionals ?? []).map((professional) => <Pressable key={professional.id} accessibilityRole="button" accessibilityState={{ selected: professionalId === professional.id }}
            onPress={() => setProfessionalId(professional.id)} style={{ padding: 8, borderRadius: 8, backgroundColor: professionalId === professional.id ? theme.primary : theme.soft }}>
            <Text style={{ color: professionalId === professional.id ? theme.onPrimary : theme.primary }}>{professional.name}</Text>
          </Pressable>)}
        </View>
      </>}
      <Field label="Título" value={title} onChangeText={setTitle} maxLength={200} />
      <Field label="Orientações para o paciente" value={instructions} onChangeText={setInstructions} multiline maxLength={4000} />
      <Text style={{ color: theme.muted, marginBottom: 8 }}>Checklist (opcional)</Text>
      {checklist.map((item, index) => <View key={index} style={{ marginBottom: 8 }}>
        <Field label={`Item ${index + 1}`} value={item} maxLength={200}
          onChangeText={(value) => setChecklist((current) => current.map((entry, position) => position === index ? value : entry))} />
        <Button label="Remover item" variant="light" onPress={() => setChecklist((current) => current.filter((_, position) => position !== index))} />
      </View>)}
      {checklist.length < 20 && <Button label="Adicionar item ao checklist" variant="light" onPress={() => setChecklist((current) => [...current, ''])} />}
      <Field label="Prazo (DD/MM/AAAA, opcional)" value={due} onChangeText={setDue} keyboardType="numbers-and-punctuation" />
      <Button label="Enviar tarefa" busy={busy} onPress={create} />
      <Button label="Voltar" variant="light" onPress={() => setCreating(false)} />
    </Card>}
  </Screen>;
}
