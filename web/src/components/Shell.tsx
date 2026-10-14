import { useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionUser } from '../../../shared/types.ts';
import logo from '../../../assets/logo.png';
import { api } from '../api.ts';
import { roleLabel } from '../format.ts';
import { useHashRoute } from '../hooks.ts';
import { AgendaPage } from '../pages/Agenda.tsx';
import { ClinicalNotesPage } from '../pages/ClinicalNotes.tsx';
import { GoogleCalendarsPage } from '../pages/GoogleCalendars.tsx';
import { PatientsPage } from '../pages/Patients.tsx';
import { ProfessionalsPage } from '../pages/Professionals.tsx';
import { UsersPage } from '../pages/Users.tsx';
import { PasswordDialog } from './PasswordDialog.tsx';

interface Route {
  path: string;
  label: string;
  render: (user: SessionUser) => ReactNode;
}

const agenda: Route = { path: 'agenda', label: 'Agenda', render: (user) => <AgendaPage user={user} /> };
const patients: Route = { path: 'pacientes', label: 'Pacientes', render: (user) => <PatientsPage user={user} /> };
const calendars: Route = { path: 'google-agenda', label: 'Google Agenda', render: () => <GoogleCalendarsPage /> };

// A administração não vê prontuários; as profissionais não gerenciam equipe nem usuários.
// As regras valem no banco (políticas RLS em supabase/migrations); o menu apenas as reflete.
const routesByRole = {
  admin: [
    agenda, patients,
    { path: 'profissionais', label: 'Profissionais', render: () => <ProfessionalsPage /> },
    { path: 'usuarios', label: 'Usuários', render: (user) => <UsersPage user={user} /> },
    calendars
  ],
  professional: [
    agenda, patients,
    { path: 'prontuarios', label: 'Prontuários', render: () => <ClinicalNotesPage /> },
    calendars
  ]
} satisfies Record<SessionUser['role'], Route[]>;

export function Shell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const path = useHashRoute();
  const [changingPassword, setChangingPassword] = useState(false);
  const routes = routesByRole[user.role];
  const current = routes.find((route) => route.path === path) ?? agenda;

  async function logout() {
    await api.logout().catch(() => {});
    window.location.hash = '';
    onLogout();
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href="#/agenda">
          <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
        </a>
        <div className="nav-label">SISTEMA DA CLÍNICA</div>
        <nav className="navigation" aria-label="Menu principal">
          {routes.map((route) => (
            <a key={route.path} href={`#/${route.path}`} className={route === current ? 'nav-item active' : 'nav-item'}
              aria-current={route === current ? 'page' : undefined}>
              {route.label}
            </a>
          ))}
        </nav>
        <div className="profile">
          <strong>{user.name}</strong>
          <span>{roleLabel[user.role]}</span>
          <button type="button" onClick={() => setChangingPassword(true)}>Trocar senha</button>
          <button type="button" onClick={logout}>Sair</button>
        </div>
      </aside>

      <div className="workspace">
        {import.meta.env.DEV && <p className="env-banner">Ambiente local de desenvolvimento</p>}
        <main key={current.path}>{current.render(user)}</main>
      </div>

      {changingPassword && <PasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
