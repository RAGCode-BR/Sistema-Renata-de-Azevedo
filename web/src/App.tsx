import { useEffect, useState } from 'react';
import type { SessionUser } from '../../shared/types.ts';
import { api, setUnauthorizedHandler } from './api.ts';
import { Shell } from './components/Shell.tsx';
import { errorMessage } from './hooks.ts';
import { LoginPage } from './pages/Login.tsx';

export function App() {
  // undefined: ainda verificando a sessão; null: ninguém conectado.
  const [user, setUser] = useState<SessionUser | null>();
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setNotice('Sua sessão terminou. Entre novamente.');
    });
    api.session().then(setUser, (failure: unknown) => {
      setUser(null);
      setNotice(errorMessage(failure));
    });
  }, []);

  if (user === undefined) return null;
  if (!user) return <LoginPage notice={notice} onLogin={(next) => { setNotice(''); setUser(next); }} />;
  return <Shell key={user.id} user={user} onLogout={() => setUser(null)} />;
}
