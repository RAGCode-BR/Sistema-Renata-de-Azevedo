import { Select } from '../components/Select.tsx';
import { useState } from 'react';
import { can } from '../../../shared/permissions.ts';
import type { PatientStatus, SessionUser } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { age, initials, patientStatusLabel, plural } from '../format.ts';
import { useLoad } from '../hooks.ts';
import { PatientForm } from './patients/PatientForm.tsx';
import { PatientPage } from './patients/PatientPage.tsx';

// #/pacientes → lista; #/pacientes?id=… → página do paciente (aba opcional em &aba=…).
export function PatientsPage({ user, patientId, tab }: { user: SessionUser; patientId: string | null; tab: string | null }) {
  if (patientId) return <PatientPage user={user} patientId={patientId} initialTab={tab} />;
  return <PatientList user={user} />;
}

const STATUS_TONE: Record<PatientStatus, string> = { active: 'chip-good', paused: 'chip-warn', discharged: 'chip-wine', inactive: 'chip-muted' };

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

// A lista só aparece depois que as fotos estão prontas para pintar. Uma imagem indisponível
// não impede a página de abrir: nesse caso, o avatar continua mostrando as iniciais.
async function preloadPatientPhotos(urls: Record<string, string>): Promise<Record<string, string>> {
  const ready = await Promise.all(Object.entries(urls).map(async ([path, url]) => {
    const image = new Image();
    image.src = url;
    let timeout = 0;
    try {
      await Promise.race([
        image.decode(),
        new Promise<never>((_resolve, reject) => { timeout = window.setTimeout(() => reject(new Error('Foto indisponível')), 8_000); })
      ]);
      return [path, url] as const;
    } catch {
      return null;
    } finally {
      window.clearTimeout(timeout);
    }
  }));
  return Object.fromEntries(ready.filter((entry): entry is readonly [string, string] => entry !== null));
}

function PatientList({ user }: { user: SessionUser }) {
  const manager = can(user, 'patients.manage');
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PatientStatus | ''>('active');
  const { data, error, loading } = useLoad(async () => {
    const [patients, professionals] = await Promise.all([api.patients(), api.professionals()]);
    const signedUrls = await api.patientPhotoUrls(patients.flatMap((item) => item.photo_path ? [item.photo_path] : []))
      .catch((): Record<string, string> => ({}));
    const photoUrls = await preloadPatientPhotos(signedUrls);
    return { patients, professionals, photoUrls };
  }, []);
  const { patients = [], professionals = [], photoUrls = {} } = data ?? {};
  const names = new Map(professionals.map((item) => [item.id, item.name]));
  const term = normalize(search.trim());
  const digits = search.replace(/\D/g, '');
  const visible = patients.filter((item) => (!status || item.status === status) && (!term
    || normalize(item.name).includes(term) || normalize(item.social_name ?? '').includes(term)
    || normalize(item.email ?? '').includes(term) || (digits.length >= 3 && (item.phone ?? '').replace(/\D/g, '').includes(digits))));

  return (
    <>
      <Heading className="patients-heading" title="Pacientes" lead={data
        ? plural(patients.filter((item) => item.status === 'active').length, 'paciente em acompanhamento', 'pacientes em acompanhamento')
        : 'Carregando pacientes…'}>
        <label className="search">
          <input type="search" placeholder="Buscar por nome, e-mail ou telefone" aria-label="Buscar paciente"
            value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <Select className="input compact" aria-label="Situação" value={status} onChange={(event) => setStatus(event.target.value as PatientStatus | '')}>
          <option value="">Todas as situações</option>
          {Object.entries(patientStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        {manager && <button type="button" className="button" disabled={loading} onClick={() => setCreating(true)}>Novo paciente</button>}
      </Heading>

      <Panel title="Lista de pacientes">
        {visible.length ? (
          <div className="table-wrap">
            <table className="table patients-table stacked">
              <thead><tr><th>Nome</th><th>Telefone</th><th>Idade</th><th>Profissionais</th><th>Situação</th></tr></thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id} className="link">
                    <td className="pt-name">
                      <div className="pt-who" data-initials={initials(item.social_name || item.name)}>
                        {item.photo_path && photoUrls[item.photo_path] && <PatientListPhoto key={item.photo_path} url={photoUrls[item.photo_path]} />}
                        <a href={`#/pacientes?id=${item.id}`}>{item.name}</a>
                        {(item.social_name || item.email) && <span className="sub">{item.social_name ? `Nome social: ${item.social_name}` : item.email}</span>}
                      </div>
                    </td>
                    <td className="pt-phone">{item.phone || '—'}</td>
                    <td className="pt-age hide-mobile">{age(item.birth_date) ?? '—'}</td>
                    <td className="pt-prof">{item.professional_ids.map((id) => names.get(id)).filter(Boolean).join(', ') || '—'}</td>
                    <td className="pt-status cell-status"><span className={`chip ${STATUS_TONE[item.status]}`}>{patientStatusLabel[item.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <PanelState error={error} loading={!data} empty={patients.length === 0 ? 'Nenhum paciente cadastrado.' : term || status ? 'Nenhum paciente encontrado com esses filtros.' : 'Nenhum paciente cadastrado.'} />
        )}
      </Panel>

      {creating && (
        <PatientForm professionals={professionals} onClose={() => setCreating(false)}
          onSaved={(id, message) => { notify(message); window.location.hash = `#/pacientes?id=${id}`; }} />
      )}
    </>
  );
}

function PatientListPhoto({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <img className="pt-photo" src={url} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}
