import { Redirect } from 'expo-router';
import { useState } from 'react';
import Constants from 'expo-constants';
import { Image, KeyboardAvoidingView, Linking, Platform, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { message } from '../lib/useLoad';
import { useTheme } from '../lib/theme';

const privacyUrl = Constants.expoConfig?.extra?.privacyUrl as string | undefined;

export default function Login() {
  const theme = useTheme();
  const { user, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Image source={require('../../assets/logo.png')} style={{ width: 220, height: 90, alignSelf: 'center', marginBottom: 12 }} resizeMode="contain" accessibilityLabel="Renata de Azevedo, Psicologia e Coaching" />
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 24 }}>Entrar no app da equipe</Text>
        <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="username" />
        <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" />
        {error ? <Text accessibilityRole="alert" style={{ color: theme.danger, marginBottom: 8 }}>{error}</Text> : null}
        <Button label="Entrar" busy={busy} disabled={!email || !password} onPress={async () => {
          setBusy(true); setError('');
          try { await signIn(email.trim(), password); } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
        }} />
        <View style={{ marginTop: 16 }}>
          <Text style={{ color: theme.muted, fontSize: 13, textAlign: 'center' }}>Use a mesma conta do sistema. Esqueceu a senha? Fale com a administração.</Text>
          {privacyUrl ? (
            <Text accessibilityRole="link" onPress={() => Linking.openURL(privacyUrl)}
              style={{ color: theme.primary, fontSize: 13, textAlign: 'center', marginTop: 12, textDecorationLine: 'underline' }}>Política de privacidade</Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
