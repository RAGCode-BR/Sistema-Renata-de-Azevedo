import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Field, Muted, Screen, State, Title } from '../../components/ui';
import { api } from '../../lib/supabase';
import { message, useLoad } from '../../lib/useLoad';

// Rascunho de evolução no celular: escrever e salvar. Finalizar e ver o histórico ficam no computador.
export default function EvolutionDraft() {
  const { sessao, paciente } = useLocalSearchParams<{ sessao: string; paciente: string }>();
  const { data, error, loading } = useLoad(async () => {
    const [record, appointment] = await Promise.all([api.clinicalRecord(paciente), api.appointment(sessao)]);
    const draft = record.notes.find((note) => note.kind === 'evolution' && note.status === 'draft' && note.appointment_id === sessao) ?? null;
    const finished = record.notes.some((note) => note.kind === 'evolution' && note.status === 'final' && note.appointment_id === sessao);
    return { draft, finished, appointment };
  }, [sessao, paciente]);
  // null: ainda não editado (mostra o rascunho salvo).
  const [edited, setBody] = useState<string | null>(null);
  const body = edited ?? data?.draft?.body ?? '';
  const [busy, setBusy] = useState(false);

  if (!data) return <Screen><State error={error} loading={loading} /></Screen>;
  if (data.finished) return <Screen><Muted>A evolução desta sessão já foi finalizada. Correções são feitas por retificação, no computador.</Muted></Screen>;
  return (
    <Screen>
      <Title sub={data.appointment ? `Sessão de ${new Date(data.appointment.starts_at).toLocaleDateString('pt-BR')}` : undefined}>{data.appointment?.patient_name ?? 'Evolução'}</Title>
      <Field label="Evolução (rascunho)" value={body} onChangeText={setBody} multiline style={{ minHeight: 240 }} />
      <Button label="Salvar rascunho" busy={busy} disabled={!body.trim()} onPress={async () => {
        setBusy(true);
        try {
          await api.saveClinicalNote({ id: data.draft?.id ?? null, patientId: paciente, appointmentId: sessao, kind: 'evolution', body });
          Alert.alert('Rascunho salvo', 'Para finalizar, abra o prontuário no computador.');
          router.back();
        } catch (failure) { Alert.alert('Não foi possível', message(failure)); } finally { setBusy(false); }
      }} />
      <Muted>Formatação feita no computador aparece com marcadores: **negrito**, *itálico* e um hífen no início da linha para lista. Mantenha os marcadores para não perder a formatação.</Muted>
      <Muted>No celular você escreve e salva o rascunho. A finalização (que torna o registro definitivo) e o histórico completo ficam no computador.</Muted>
    </Screen>
  );
}
