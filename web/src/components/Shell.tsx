import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { SessionUser } from '../../../shared/types.ts';
import logo from '../../../assets/logo.png';
import { api } from '../api.ts';
import { can, roleLabel } from '../../../shared/permissions.ts';
import { useHashRoute } from '../hooks.ts';
import { AgendaPage } from '../pages/Agenda.tsx';
import { HomePage } from '../pages/Home.tsx';
import { ClinicalNotesPage } from '../pages/ClinicalNotes.tsx';
import { GoogleCalendarsPage } from '../pages/GoogleCalendars.tsx';
import { PatientsPage } from '../pages/Patients.tsx';
import { PrintRecordPage } from '../pages/PrintRecord.tsx';
import { RecordControlPage } from '../pages/RecordControl.tsx';
import { SettingsPage } from '../pages/Settings.tsx';
import { ProfessionalsPage } from '../pages/Professionals.tsx';
import { UsersPage } from '../pages/Users.tsx';
import { ChargesPage } from '../pages/finance/Charges.tsx';
import { ExpensesPage } from '../pages/finance/Expenses.tsx';
import { FinanceOverviewPage } from '../pages/finance/Overview.tsx';
import { PayoutsPage } from '../pages/finance/Payouts.tsx';
import { PricesPage } from '../pages/finance/Prices.tsx';
import { PasswordDialog } from './PasswordDialog.tsx';

interface Route {
  path: string;
  label: string;
  render: (user: SessionUser, params: URLSearchParams) => ReactNode;
}

interface Module {
  title: string;
  icon: IconName;
  routes: Route[];
}

const home: Route = { path: 'inicio', label: 'Início', render: (user) => <HomePage user={user} /> };
const agenda: Route = {
  path: 'agenda', label: 'Agenda',
  render: (user, params) => <AgendaPage user={user} date={params.get('data')} session={params.get('sessao')} />
};
const patients: Route = {
  path: 'pacientes', label: 'Pacientes',
  render: (user, params) => <PatientsPage user={user} patientId={params.get('id')} tab={params.get('aba')} />
};
const calendars: Route = { path: 'google-agenda', label: 'Google Agenda', render: () => <GoogleCalendarsPage /> };

const clinicalNotes: Route = {
  path: 'prontuarios', label: 'Prontuários',
  render: (user, params) => <ClinicalNotesPage user={user} patientId={params.get('paciente')} appointmentId={params.get('sessao')} />
};
const recordControl: Route = { path: 'controle-prontuarios', label: 'Controle de prontuários', render: () => <RecordControlPage /> };
const settings: Route = { path: 'configuracoes', label: 'Configurações', render: () => <SettingsPage /> };
// Fora do menu: aberta pelo botão "Exportar prontuário".
const printRecord: Route = { path: 'prontuario-impressao', label: 'Exportar prontuário', render: (_user, params) => <PrintRecordPage patientId={params.get('paciente')} /> };
const professionals: Route = { path: 'profissionais', label: 'Profissionais', render: () => <ProfessionalsPage /> };
const users: Route = { path: 'usuarios', label: 'Usuários', render: (user) => <UsersPage user={user} /> };
const financeOverview: Route = { path: 'financeiro', label: 'Visão geral', render: () => <FinanceOverviewPage /> };
const charges: Route = { path: 'cobrancas', label: 'Cobranças', render: (user) => <ChargesPage user={user} /> };
const expenses: Route = { path: 'despesas', label: 'Despesas', render: (user) => <ExpensesPage user={user} /> };
const payouts: Route = { path: 'repasses', label: 'Repasses', render: (user) => <PayoutsPage user={user} /> };
const myPayout: Route = { ...payouts, label: 'Meu repasse' };
const prices: Route = { path: 'precos', label: 'Preços', render: (user) => <PricesPage user={user} /> };

// O menu segue as permissões de quem está conectado (uma pessoa pode ter vários perfis).
// As regras valem no banco (RLS); o menu apenas as reflete.
function modulesFor(user: SessionUser): Module[] {
  const professional = user.roles.includes('professional');
  const modules: Module[] = [
    { title: 'Início', icon: 'home', routes: [home] },
    { title: 'Atendimento', icon: 'calendar', routes: [agenda, calendars] },
    {
      title: 'Pacientes', icon: 'users', routes: [
        ...(can(user, 'patients.view_all') || professional ? [patients] : []),
        ...(professional ? [clinicalNotes] : []),
        ...(can(user, 'appointments.view_all') ? [recordControl] : [])
      ]
    },
    {
      title: 'Equipe', icon: 'team', routes: [
        ...(can(user, 'professionals.manage') ? [professionals] : []),
        ...(can(user, 'users.manage') ? [users] : [])
      ]
    },
    {
      // Resultado, despesas e repasses: Proprietário(a) e Financeiro. Cobranças: quem atende o caixa.
      // Profissional: as cobranças das próprias sessões e o próprio repasse.
      title: 'Financeiro', icon: 'wallet', routes: [
        ...(can(user, 'finance.view') ? [financeOverview] : []),
        ...(can(user, 'billing.view') || professional ? [charges] : []),
        ...(can(user, 'finance.view') ? [expenses, payouts] : professional ? [myPayout] : []),
        ...(can(user, 'billing.view') || can(user, 'finance.view') ? [prices] : [])
      ]
    }
  ];
  if (can(user, 'settings.manage')) modules.push({ title: 'Configurações', icon: 'gear', routes: [settings] });
  return modules.filter((module) => module.routes.length);
}

const SUBMENU_KEY = 'rda-submenu';

function readSubmenu(): boolean {
  try { return localStorage.getItem(SUBMENU_KEY) !== 'fechado'; } catch { return true; }
}

export function Shell({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const { path, params } = useHashRoute();
  const [changingPassword, setChangingPassword] = useState(false);
  const [submenuOpen, setSubmenuOpen] = useState(readSubmenu);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const modules = modulesFor(user);
  const routes = [...modules.flatMap((module) => module.routes), ...(user.roles.includes('professional') ? [printRecord] : [])];
  const current = routes.find((route) => route.path === path) ?? home;
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
        <a className="brand" href="#/inicio">
          <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
        </a>

        <div className="top-actions" ref={accountRef}>
          <button type="button" className="avatar-btn" aria-label="Sua conta" aria-expanded={accountOpen} aria-controls="conta-menu"
            onClick={() => setAccountOpen(!accountOpen)}>
            {initials}
          </button>
          <div className="pop" id="conta-menu" hidden={!accountOpen}>
            <div className="pop-title">{user.name}<br />{user.roles.map((role) => roleLabel[role]).join(' · ')}</div>
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
        {import.meta.env.DEV && <p className="env-banner">Ambiente local de desenvolvimento</p>}
        <main key={`${current.path}?${params}`}>{current.render(user, params)}</main>
      </div>

      {changingPassword && <PasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  );
}

const ICONS = {
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  home: <><path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>,
  users: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.8 19.5c.6-3.2 3.1-5.2 6.2-5.2s5.6 2 6.2 5.2M16 5.3a3.4 3.4 0 0 1 0 6.4M18.3 14.6c1.6.8 2.6 2.4 2.9 4.9" /></>,
  team: <><rect x="3.5" y="7" width="17" height="13" rx="3" /><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></>,
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="8" width="16.5" height="11.5" rx="2.5" /><path d="M16.5 13.75h.01" strokeWidth="2.4" /></>,
  logout: <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l-4-4 4-4M6 12h9" />
};

type IconName = keyof typeof ICONS;

function Icon({ name }: { name: IconName }) {
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}
