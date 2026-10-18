import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { formatCpf, longDay, patientStatusLabel, statusLabel, time } from '../../../../shared/format.ts';
import { Button, Card, Muted, Row, Screen, State, Title } from '../../components/ui';
import { call, whatsapp } from '../../lib/contact';
import { api } from '../../lib/supabase';
import { useLoad } from '../../lib/useLoad';

// Ficha básica do paciente (as mesmas regras de quem vê o quê do sistema). Nada clínico aqui.
export default function PatientScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.patient(id), api.professionals(), api.patientAppointments(id)]), [id]);
  if (!data?.[0]) return <Screen><State error={error || (data ? 'Paciente não encontrado ou fora da sua carteira.' : '')} loading={loading} /></Screen>;
  const [patient, professionals, appointments] = data;
  const names = professionals.filter((item) => patient.professional_ids.includes(item.id)).map((item) => item.name).join(', ');
  const upcoming = appointments.filter((item) => new Date(item.starts_at).getTime() > Date.now() && ['scheduled', 'awaiting_confirmation', 'confirmed'].includes(item.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 5);

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Title sub={[patientStatusLabel[patient.status], names && `com ${names}`].filter(Boolean).join(' · ')}>{patient.social_name || patient.name}</Title>
      {patient.phone && (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 6 }}>
          <View style={{ flex: 1 }}><Button label="Ligar" variant="light" onPress={() => call(patient.phone!)} /></View>
          <View style={{ flex: 1 }}><Button label="WhatsApp" variant="light" onPress={() => whatsapp(patient.phone!)} /></View>
        </View>
      )}
      <Card title="Contato">
        <Row title="Telefone" right={patient.phone ?? '—'} />
        <Row title="E-mail" right={patient.email ?? '—'} />
        <Row title="CPF" right={formatCpf(patient.cpf)} />
        {patient.guardian_name ? <Row title="Responsável" detail={[patient.guardian_name, patient.guardian_phone].filter(Boolean).join(' · ')} /> : null}
      </Card>
      <Card title="Próximas sessões">
        {!upcoming.length && <Muted>Nenhuma sessão marcada.</Muted>}
        {upcoming.map((item) => (
          <Row key={item.id} title={`${longDay(item.starts_at)}, ${time(item.starts_at)}`} detail={`${item.professional_name} · ${statusLabel[item.status]}`}
            onPress={() => router.push(`/sessao/${item.id}`)} />
        ))}
      </Card>
      <Muted>Cadastro completo, documentos e prontuário ficam no sistema web.</Muted>
    </Screen>
  );
}
