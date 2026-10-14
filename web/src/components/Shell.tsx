import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionUser } from '../../../shared/types.ts';
import logo from '../../../assets/logo.png';
import { api } from '../api.ts';
import { roleLabel } from '../format.ts';
import { useHashRoute } from '../hooks.ts';
import { AccountsPage } from '../pages/Accounts.tsx';
import { AgendaPage } from '../pages/Agenda.tsx';
import { ClinicalNotesPage } from '../pages/ClinicalNotes.tsx';
import { GoogleCalendarsPage } from '../pages/GoogleCalendars.tsx';
import { PatientsPage } from '../pages/Patients.tsx';
import { ProfessionalsPage } from '../pages/Professionals.tsx';
import { PasswordDialog } from './PasswordDialog.tsx';

interface Route {
  path: string;
  label: string;
  render: (user: SessionUser) => ReactNode;
}

interface Module {
  title: string;
  icon: IconName;
  routes: Route[];
}

const agenda: Route = { path: 'agenda', label: 'Agenda', render: (user) => <AgendaPage user={user} /> };
const patients: Route = { path: 'pacientes', label: 'Pacientes', render: (user) => <PatientsPage user={user} /> };
const calendars: Route = { path: 'google-agenda', label: 'Google Agenda', render: () => <GoogleCalendarsPage /> };

// A administração não vê prontuários; as profissionais não gerenciam equipe nem contas.
// O servidor aplica as mesmas regras, o menu apenas as reflete.
const modulesByRole = {
  admin: [
    { title: 'Atendimento', icon: 'calendar', routes: [agenda, calendars] },
    { title: 'Pacientes', icon: 'users', routes: [patients] },
    {
      title: 'Equipe', icon: 'team', routes: [
        { path: 'profissionais', label: 'Profissionais', render: () => <ProfessionalsPage /> },
        { path: 'contas', label: 'Contas', render: () => <AccountsPage /> }
      ]
    }
  ],
  professional: [
    { title: 'Atendimento', icon: 'calendar', routes: [agenda, calendars] },
    {
      title: 'Pacientes', icon: 'users', routes: [
        patients,
        { path: 'prontuarios', label: 'Prontuários', render: () => <ClinicalNotesPage /> }
      ]
    }
  ]
} satisfies Record<SessionUser['role'], Module[]>;

const SUBMENU_KEY = 'rda-submenu';

function readSubmenu(): boolean {
  try { return localStorage.getItem(SUBMENU_KEY) !== 'fechado'; } catch { return true; }
}

export function Shell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const path = useHashRoute();
  const [changingPassword, setChangingPassword] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(readSubmenu);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const modules: Module[] = modulesByRole[user.role];
  const routes = modules.flatMap((module) => module.routes);
  const current = routes.find((route) => route.path === path) ?? agenda;
  const currentModule = modules.find((module) => module.routes.includes(current)) ?? modules[0];
  const initials = user.name.split(' ').filter((part) => part.length > 2).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !accountRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', close);
    };
  }, [accountOpen]);

  function toggleSubmenu() {
    const next = !submenuOpen;
    setSubmenuOpen(next);
    try { localStorage.setItem(SUBMENU_KEY, next ? 'aberto' : 'fechado'); } catch { /* preferência só desta visita */ }
  }

  async function logout() {
    await api.logout().catch(() => {});
    window.location.hash = '';
    onLogout();
  }

  return (
    <div className={submenuOpen ? 'app' : 'app sem-submenu'}>
      <header className="topbar">
        <button type="button" className="icon-btn menu-toggle" onClick={toggleSubmenu}
          aria-expanded={submenuOpen} aria-controls="subnav" aria-label={submenuOpen ? 'Recolher menu' : 'Abrir menu'}>
          <Icon name="menu" />
        </button>
        <a className="brand" href="#/agenda">
          <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
        </a>

        <div className="top-actions" ref={accountRef}>
          <button type="button" className="avatar-btn" aria-label="Sua conta" aria-expanded={accountOpen} aria-controls="conta-menu"
            onClick={() => setAccountOpen(!accountOpen)}>
            {initials}
          </button>
          <div className="pop" id="conta-menu" hidden={!accountOpen}>
            <div className="pop-title">{user.name}<br />{roleLabel[user.role]}</div>
            <button type="button" className="pop-item" onClick={() => { setAccountOpen(false); setChangingPassword(true); }}>
              <Icon name="key" />Trocar senha
            </button>
            <hr />
            <button type="button" className="pop-item" onClick={logout}><Icon name="logout" />Sair</button>
          </div>
        </div>
      </header>

      <nav className="rail" aria-label="Módulos">
        {modules.map((module) => {
          const active = module === currentModule;
          return (
            <a key={module.title} href={`#/${module.routes[0].path}`} className={active ? 'rail-link has-tip active' : 'rail-link has-tip'}
              data-tip={module.title} aria-label={module.title} aria-current={active ? 'true' : undefined}>
              <Icon name={module.icon} /><span>{module.title}</span>
            </a>
          );
        })}
      </nav>

      <aside className="subnav" id="subnav" aria-label="Páginas do módulo">
        <div className="subnav-inner">
          <h2>{currentModule.title}</h2>
          <div className="subnav-list">
            {currentModule.routes.map((route) => (
              <a key={route.path} href={`#/${route.path}`} className={route === current ? 'sub-link active' : 'sub-link'}
                aria-current={route === current ? 'page' : undefined}>
                {route.label}
              </a>
            ))}
          </div>
        </div>
      </aside>

      <div className="workspace">
        <p className="env-banner">Ambiente local de desenvolvimento</p>
        <main key={current.path}>{current.render(user)}</main>
      </div>

      {changingPassword && <PasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

const ICONS = {
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.8 19.5c.6-3.2 3.1-5.2 6.2-5.2s5.6 2 6.2 5.2M16 5.3a3.4 3.4 0 0 1 0 6.4M18.3 14.6c1.6.8 2.6 2.4 2.9 4.9" /></>,
  team: <><rect x="3.5" y="7" width="17" height="13" rx="3" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></>,
  logout: <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l-4-4 4-4M6 12h9" />
};

type IconName = keyof typeof ICONS;

function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}
