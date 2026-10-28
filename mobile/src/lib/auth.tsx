import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { SessionUser } from '../../../shared/types.ts';
import { registerForPush } from './push';
import { api, supabase } from './supabase';

// Sessão da equipe no aparelho:
// - pede digital, rosto ou senha depois de 5 minutos em segundo plano;
// - encerra a sessão depois de 30 dias sem abrir o app;
// - registra o aparelho para push (quando configurado) e o remove ao sair.
const LOCK_AFTER_MS = 5 * 60_000;
const EXPIRE_AFTER_MS = 30 * 86_400_000;
const LAST_USE = 'rda.ultimo_uso';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  locked: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  unlock: (password?: string) => Promise<boolean>;
  // Código do app autenticador (verificação em duas etapas).
  verifyMfa: (code: string) => Promise<void>;
  canUseBiometrics: boolean;
}
const AuthContext = createContext<AuthState | null>(null);
export const useAuth = () => useContext(AuthContext)!;

const store = {
  get: (key: string) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null) : SecureStore.getItemAsync(key)),
  set: (key: string, value: string) => (Platform.OS === 'web' ? Promise.resolve(globalThis.localStorage?.setItem(key, value)) : SecureStore.setItemAsync(key, value))
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [canUseBiometrics, setBiometrics] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  const pushToken = useRef<string | null>(null);

  const load = useCallback(async () => {
    const current = await api.session().catch(() => null);
    setUser(current);
    if (current) {
      await store.set(LAST_USE, String(Date.now()));
      registerForPush().then((token) => { pushToken.current = token; }, () => undefined);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const last = Number(await store.get(LAST_USE));
      if (last && Date.now() - last > EXPIRE_AFTER_MS) await supabase.auth.signOut().catch(() => undefined);
      if (Platform.OS !== 'web') {
        setBiometrics(await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync());
      }
      await load();
      setLoading(false);
    })();
    api.setUnauthorizedHandler(() => { setUser(null); setLocked(false); });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (backgroundAt.current && Date.now() - backgroundAt.current > LOCK_AFTER_MS) setLocked(true);
        backgroundAt.current = null;
        store.set(LAST_USE, String(Date.now()));
      } else if (backgroundAt.current === null) {
        backgroundAt.current = Date.now();
      }
    });
    return () => subscription.remove();
  }, [load]);

  const value: AuthState = {
    user, loading, locked, canUseBiometrics,
    signIn: async (username, password) => {
      await api.login(username, password);
      await load();
      if (!(await api.session())) {
        const patient = await api.isPatientAccount().catch(() => false);
        await api.logout();
        throw new Error(patient ? 'Esta conta é de paciente: use o portal do paciente, pelo navegador.'
          : 'Esta conta não tem acesso ao aplicativo da equipe.');
      }
    },
    signOut: async () => {
      if (pushToken.current) await api.unregisterPushDevice(pushToken.current).catch(() => undefined);
      await api.logout();
      setUser(null);
      setLocked(false);
    },
    unlock: async (password) => {
      if (password && user) {
        const { error } = await supabase.auth.signInWithPassword({ email: user.email, password });
        if (error) return false;
        // Entrar de novo com a senha cria uma sessão só de senha: quem usa o código digita de novo.
        await load();
      } else {
        const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Desbloquear o app da clínica', cancelLabel: 'Usar senha' });
        if (!result.success) return false;
      }
      setLocked(false);
      return true;
    },
    verifyMfa: async (code) => {
      await api.mfaVerify(code);
      await load();
    }
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
