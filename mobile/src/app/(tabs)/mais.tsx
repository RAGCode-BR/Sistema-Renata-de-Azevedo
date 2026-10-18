import { router } from 'expo-router';
import { can, roleLabel } from '../../../../shared/permissions.ts';
import { Button, Card, Muted, Row, Screen, Title } from '../../components/ui';
import { useAuth } from '../../lib/auth';

export default function More() {
  const { user, signOut } = useAuth();
  const professional = user!.roles.includes('professional');
  return (
    <Screen>
      <Title sub={user!.roles.map((role) => roleLabel[role]).join(' · ')}>{user!.name}</Title>
      <Card>
        <Row title="Avisos" detail="Tarefas, mensagens e leads" onPress={() => router.push('/avisos')} />
        {can(user!, 'billing.view') && <Row title="Cobranças em aberto" detail="Registrar pagamento" onPress={() => router.push('/cobrancas')} />}
        {professional && <Row title="Meu repasse" onPress={() => router.push('/repasse')} />}
      </Card>
      <Muted>Comercial, relatórios, configurações, conversas do WhatsApp e o assistente de IA ficam no sistema web.</Muted>
      <Button label="Sair da conta" variant="light" onPress={signOut} />
    </Screen>
  );
}
