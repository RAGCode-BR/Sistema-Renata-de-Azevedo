import { Select } from '../components/Select.tsx';
import { useEffect, useState } from 'react';
import type { PortalMe } from '../../../shared/types.ts';
import logo from '../../../assets/logo.png';
import { api, setUnauthorizedHandler } from '../api.ts';
import { supabase } from '../supabase.ts';
import { errorMessage, useHashRoute } from '../hooks.ts';
import { PortalLogin } from './PortalLogin.tsx';
import { PortalTerms } from './PortalTerms.tsx';
import { Appointments, Documents, Finance, Home, Notices } from './pages.tsx';
import { PatientActivities } from './PatientActivities.tsx';

const PAGES = [['inicio', 'Início'], ['consultas', 'Sessões'], ['atividades', 'Minhas tarefas'], ['financeiro', 'Financeiro'], ['documentos', 'Documentos'], ['avisos', 'Avisos']] as const;
type Page = typeof PAGES[number][0];
const PATIENT_KEY = 'portal-paciente';

function readPatient(): string | null {
  try { return localStorage.getItem(PATIENT_KEY); } catch { return null; }
}
function savePatient(id: string) {
  try { localStorage.setItem(PATIENT_KEY, id); } catch { /* sem armazenamento: escolhe de novo na próxima vez */ }
}

// Portal do paciente (#/portal/...). Separado do sistema da equipe: entrada por código, termos de uso e
// só as funções portal_* do banco, que conferem o vínculo da conta com o paciente.
export function PortalApp() {
  // undefined: verificando; null: ninguém conectado.
  const [me, setMe] = useState<PortalMe | null>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    setError('');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setMe(null); return; }
    try {
      setMe(await api.portalMe());
    } catch (failure) {
      setError(errorMessage(failure));
      setMe(null);
    }
  }

  useEffect(() => {
    document.title = 'Portal do paciente · Renata de Azevedo';
    setUnauthorizedHandler(() => { setMe(null); setNotice('Sua sessão terminou. Entre novamente.'); });
    load();
  }, []);

  async function logout() {
    await api.logout();
    setMe(null);
  }

  if (me === undefined) return null;
  if (!me) return <PortalLogin notice={error || notice} onLogin={() => { setNotice(''); load(); }} />;
  if (!me.portal_user) {
    return (
      <Blocked title="Esta conta não é de paciente" onLogout={logout}>
        O portal é para pacientes e responsáveis. A equipe da clínica usa o <a href="#/">sistema</a>.
      </Blocked>
    );
  }
  if (!me.enabled) return <Blocked title="Portal indisponível" onLogout={logout}>O portal está temporariamente indisponível. Em caso de dúvida, fale com a clínica.</Blocked>;
  if (!me.patients.length) return <Blocked title="Sem acesso no momento" onLogout={logout}>Seu acesso ao portal não está ativo. Se precisar, fale com a clínica.</Blocked>;
  if (!me.terms_accepted) return <PortalTerms version={me.terms_version} onAccepted={load} onLogout={logout} />;
  return <PortalShell me={me} onLogout={logout} />;
}

function Blocked({ title, children, onLogout }: { title: string; children: React.ReactNode; onLogout: () => void }) {
  return (
    <div className="login-layout">
      <div className="login-card">
        <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
        <h1>{title}</h1>
        <p className="muted">{children}</p>
        <button type="button" className="button light" onClick={onLogout}>Sair</button>
      </div>
    </div>
  );
}

function PortalShell({ me, onLogout }: { me: PortalMe; onLogout: () => void }) {
  const route = useHashRoute();
  const page: Page = PAGES.find(([key]) => route.path === `portal/${key}`)?.[0] ?? 'inicio';
  const [patientId, setPatientId] = useState(() => {
    const saved = readPatient();
    return me.patients.some((item) => item.id === saved) ? saved! : me.patients[0].id;
  });
  const patient = me.patients.find((item) => item.id === patientId)!;

  useEffect(() => { window.scrollTo(0, 0); }, [page]);

  return (
    <div className="portal">
      <header className="portal-top">
        <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
        <div className="portal-who">
          <span>{me.name}</span>
          <button type="button" className="link-btn" onClick={onLogout}>Sair</button>
        </div>
      </header>
      <nav className="portal-nav" aria-label="Portal do paciente">
        {PAGES.map(([key, label]) => (
          <a key={key} href={`#/portal/${key}`} className={page === key ? 'on' : undefined} aria-current={page === key ? 'page' : undefined}>{label}</a>
        ))}
      </nav>
      <main className="portal-main">
        {me.patients.length > 1 && (
          <label className="field portal-patient">
            <span>Paciente</span>
            <Select className="input" value={patientId} onChange={(event) => { setPatientId(event.target.value); savePatient(event.target.value); }}>
              {me.patients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Select>
          </label>
        )}
        {page === 'inicio' && <Home key={patientId} me={me} patient={patient} />}
        {page === 'consultas' && <Appointments key={patientId} patientId={patientId} />}
        {page === 'atividades' && <PatientActivities key={patientId} patientId={patientId} />}
        {page === 'financeiro' && <Finance key={patientId} patientId={patientId} instructions={me.payment_instructions} />}
        {page === 'documentos' && <Documents key={patientId} patientId={patientId} />}
        {page === 'avisos' && <Notices />}
      </main>
      <footer className="portal-foot muted small">
        Em situação de urgência, não use o portal: ligue 192 (SAMU) ou 188 (CVV).
      </footer>
    </div>
  );
}
