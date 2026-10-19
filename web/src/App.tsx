import { lazy, Suspense, useEffect, useState } from 'react';
import type { SessionUser } from '../../shared/types.ts';
import { api, setUnauthorizedHandler } from './api.ts';
import { Shell } from './components/Shell.tsx';
import { errorMessage } from './hooks.ts';
import { LoginPage } from './pages/Login.tsx';
import { MfaGate } from './components/TwoFactor.tsx';

// Portal do paciente: carregado à parte, em #/portal ou num endereço que comece com "portal.".
const PortalApp = lazy(() => import('./portal/PortalApp.tsx').then((module) => ({ default: module.PortalApp })));
const isPortal = () => window.location.hash.startsWith('#/portal') || window.location.hostname.startsWith('portal.');

export function App() {
  const [portal, setPortal] = useState(isPortal);
  useEffect(() => {
    const update = () => setPortal(isPortal());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  if (portal) return <Suspense fallback={null}><PortalApp /></Suspense>;
  return <StaffApp />;
}

function StaffApp() {
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
  if (user.mfa !== 'ok') {
    return <MfaGate mode={user.mfa} onLogout={async () => { await api.logout(); setUser(null); }}
      onDone={() => api.session().then(setUser, (failure: unknown) => { setUser(null); setNotice(errorMessage(failure)); })} />;
  }
  return <Shell key={user.id} user={user} onLogout={() => setUser(null)} />;
}
