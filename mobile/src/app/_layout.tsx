import * as Notifications from 'expo-notifications';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Field } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { routeForLink } from '../lib/push';
import { useTheme } from '../lib/theme';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true })
  });
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function Root() {
  const theme = useTheme();
  const { loading, locked, user } = useAuth();

  // Toque numa notificação abre a tela correspondente (depois do desbloqueio, se houver).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      router.push(routeForLink(response.notification.request.content.data?.link as string | undefined) as never);
    });
    return () => subscription.remove();
  }, []);

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background }}><ActivityIndicator color={theme.primary} /></View>;
  }
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{
        headerStyle: { backgroundColor: theme.card }, headerTintColor: theme.primary, headerTitleStyle: { color: theme.text },
        contentStyle: { backgroundColor: theme.background }, headerBackButtonDisplayMode: 'minimal'
      }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="sessao/[id]" options={{ title: 'Sessão' }} />
        <Stack.Screen name="paciente/[id]" options={{ title: 'Paciente' }} />
        <Stack.Screen name="evolucao/[sessao]" options={{ title: 'Rascunho de evolução' }} />
        <Stack.Screen name="avisos" options={{ title: 'Avisos' }} />
        <Stack.Screen name="cobrancas" options={{ title: 'Cobranças em aberto' }} />
        <Stack.Screen name="repasse" options={{ title: 'Meu repasse' }} />
      </Stack>
      {user && !locked && user.mfa !== 'ok' && <MfaScreen />}
      {user && locked && <LockScreen />}
    </>
  );
}

// Tela de desbloqueio (depois de 5 minutos em segundo plano): digital/rosto ou senha.
function LockScreen() {
  const theme = useTheme();
  const { unlock, canUseBiometrics, user, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Só ao abrir a tela de bloqueio: oferece a digital/rosto uma vez.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (canUseBiometrics) unlock(); }, []);
  return (
    <View accessibilityViewIsModal style={{ position: 'absolute', inset: 0, backgroundColor: theme.background, padding: 24, justifyContent: 'center' }}>
      <Image source={require('../../assets/logo.png')} style={{ width: 180, height: 70, alignSelf: 'center', marginBottom: 24 }} resizeMode="contain" accessibilityLabel="Renata de Azevedo" />
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>App bloqueado</Text>
      <Text style={{ color: theme.muted, textAlign: 'center', marginBottom: 20 }}>Para continuar, {user?.name.split(' ')[0]}, confirme que é você.</Text>
      {canUseBiometrics && <Button label="Usar digital ou rosto" onPress={() => unlock()} />}
      <View style={{ marginTop: 16 }}>
        <Field label="Senha" secureTextEntry value={password} onChangeText={setPassword} autoComplete="current-password" />
        {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, marginBottom: 8 }}>{error}</Text> : null}
        <Button label="Desbloquear com a senha" variant="light" busy={busy} disabled={!password} onPress={async () => {
          setBusy(true);
          const ok = await unlock(password);
          setBusy(false);
          if (!ok) setError('Senha incorreta.'); else setPassword('');
        }} />
        <Button label="Sair da conta" variant="light" onPress={signOut} />
      </View>
    </View>
  );
}

// Verificação em duas etapas: o código do app autenticador. O cadastro do app é feito pelo computador
// (o QR code precisa ser lido com o celular).
function MfaScreen() {
  const theme = useTheme();
  const { user, verifyMfa, signOut } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <View accessibilityViewIsModal style={{ position: 'absolute', inset: 0, backgroundColor: theme.background, padding: 24, justifyContent: 'center' }}>
      <Image source={require('../../assets/logo.png')} style={{ width: 180, height: 70, alignSelf: 'center', marginBottom: 24 }} resizeMode="contain" accessibilityLabel="Renata de Azevedo" />
      <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>Verificação em duas etapas</Text>
      {user?.mfa === 'verify' ? (
        <>
          <Text style={{ color: theme.muted, textAlign: 'center', marginBottom: 20 }}>Abra o app autenticador e digite o código da clínica.</Text>
          <Field label="Código" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={7} />
          {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, marginBottom: 8 }}>{error}</Text> : null}
          <Button label="Confirmar" busy={busy} disabled={code.replace(/\D/g, '').length !== 6} onPress={async () => {
            setBusy(true); setError('');
            try { await verifyMfa(code); setCode(''); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Código inválido.'); } finally { setBusy(false); }
          }} />
        </>
      ) : (
        <Text style={{ color: theme.muted, textAlign: 'center', marginBottom: 20 }}>
          A clínica exige um código do celular para o seu perfil. Entre primeiro pelo sistema no computador, que mostra o passo a passo do app autenticador, e depois entre aqui de novo.
        </Text>
      )}
      <View style={{ marginTop: 8 }}><Button label="Sair da conta" variant="light" onPress={signOut} /></View>
    </View>
  );
}
