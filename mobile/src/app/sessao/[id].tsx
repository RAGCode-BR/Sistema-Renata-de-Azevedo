import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { can } from '../../../../shared/permissions.ts';
import { longDay, modalityLabel, sessionTypeLabel, statusLabel, time } from '../../../../shared/format.ts';
import { Button, Card, Field, Muted, Row, Screen, State, Tabs, Title } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { call, whatsapp } from '../../lib/contact';
import { api } from '../../lib/supabase';
import { message, useLoad } from '../../lib/useLoad';

// Sessão: confirmar, registrar presença ou falta, cancelar; entrar no Meet; ligar/WhatsApp do paciente.
export default function Session() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(async () => {
    const appointment = await api.appointment(id);
    const patient = appointment ? await api.patient(appointment.patient_id).catch(() => null) : null;
    return { appointment, patient };
  }, [id]);
  const [busy, setBusy] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [by, setBy] = useState<'patient' | 'clinic'>('patient');
  const [reason, setReason] = useState('');

  if (!data?.appointment) return <Screen><State error={error || (data ? 'Sessão não encontrada.' : '')} loading={loading} /></Screen>;
  const { appointment, patient } = data;
  const canManage = can(user!, 'appointments.manage') || appointment.professional_id === user!.professional_id;
  const started = new Date(appointment.starts_at).getTime() <= Date.now();
  const open = ['scheduled', 'awaiting_confirmation', 'confirmed'].includes(appointment.status);
  const own = appointment.professional_id === user!.professional_id;

  async function act(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    try { await action(); Alert.alert(done); reload(); } catch (failure) { Alert.alert('Não foi possível', message(failure)); } finally { setBusy(''); }
  }

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Title sub={`${longDay(appointment.starts_at)}, ${time(appointment.starts_at)}–${time(appointment.ends_at)}`}>{appointment.patient_name}</Title>
      <Card>
        <Row title="Profissional" right={appointment.professional_name} />
        <Row title="Atendimento" right={`${sessionTypeLabel[appointment.session_type]}, ${modalityLabel[appointment.modality].toLowerCase()}`} />
        <Row title="Situação" right={statusLabel[appointment.status]} />
        {appointment.cancellation_reason ? <Row title="Motivo" detail={appointment.cancellation_reason} /> : null}
      </Card>
      {appointment.meeting_url && open && <Button label="Entrar no Google Meet" onPress={() => Linking.openURL(appointment.meeting_url!)} />}
      {patient?.phone && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button label="Ligar" variant="light" onPress={() => call(patient.phone!)} /></View>
          <View style={{ flex: 1 }}><Button label="WhatsApp" variant="light" onPress={() => whatsapp(patient.phone!)} /></View>
        </View>
      )}
      {canManage && open && (
        <Card title="Ações">
          {!started && appointment.status !== 'confirmed' && (
            <Button label="Confirmar sessão" busy={busy === 'confirm'} onPress={() => act('confirm', () => api.setAppointmentStatus(appointment.id, 'confirmed'), 'Sessão confirmada.')} />
          )}
          {started && <>
            <Button label="Realizada" busy={busy === 'done'} onPress={() => act('done', () => api.setAppointmentStatus(appointment.id, 'completed'), 'Presença registrada.')} />
            <Button label="Faltou" variant="light" busy={busy === 'missed'} onPress={() => act('missed', () => api.setAppointmentStatus(appointment.id, 'missed'), 'Falta registrada.')} />
          </>}
          {!cancelling ? <Button label="Cancelar sessão" variant="light" onPress={() => setCancelling(true)} /> : (
            <View style={{ marginTop: 12 }}>
              <Tabs value={by} onChange={setBy} options={[['patient', 'Pelo paciente'], ['clinic', 'Pela clínica']]} />
              <Field label="Motivo (opcional)" value={reason} onChangeText={setReason} maxLength={500} />
              <Button label="Confirmar cancelamento" variant="danger" busy={busy === 'cancel'}
                onPress={() => act('cancel', () => api.cancelAppointment(appointment.id, by, reason, false), 'Sessão cancelada.')} />
            </View>
          )}
        </Card>
      )}
      {own && appointment.status === 'completed' && (
        <Button label="Escrever rascunho de evolução" variant="light"
          onPress={() => router.push(`/evolucao/${appointment.id}?paciente=${appointment.patient_id}`)} />
      )}
      <Muted>Remarcações e séries ficam no sistema web.</Muted>
      {patient && <Button label="Ver ficha do paciente" variant="light" onPress={() => router.push(`/paciente/${patient.id}`)} />}
    </Screen>
  );
}
