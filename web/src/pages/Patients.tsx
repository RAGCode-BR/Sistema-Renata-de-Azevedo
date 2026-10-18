import { useState } from 'react';
import { can } from '../../../shared/permissions.ts';
import type { PatientStatus, SessionUser } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { age, patientStatusLabel, plural } from '../format.ts';
import { useLoad } from '../hooks.ts';
import { PatientForm } from './patients/PatientForm.tsx';
import { PatientPage } from './patients/PatientPage.tsx';

// #/pacientes → lista; #/pacientes?id=… → página do paciente (aba opcional em &aba=…).
export function PatientsPage({ user, patientId, tab }: { user: SessionUser; patientId: string | null; tab: string | null }) {
  if (patientId) return <PatientPage user={user} patientId={patientId} initialTab={tab} />;
  return <PatientList user={user} />;
}

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

function PatientList({ user }: { user: SessionUser }) {
  const manager = can(user, 'patients.manage');
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PatientStatus | ''>('active');
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.patients(), api.professionals()]), []);
  const [patients, professionals] = data ?? [[], []];
  const names = new Map(professionals.map((item) => [item.id, item.name]));
  const term = normalize(search.trim());
  const digits = search.replace(/\D/g, '');
  const visible = patients.filter((item) => (!status || item.status === status) && (!term
    || normalize(item.name).includes(term) || normalize(item.social_name ?? '').includes(term)
    || normalize(item.email ?? '').includes(term) || (digits.length >= 3 && (item.phone ?? '').replace(/\D/g, '').includes(digits))));

  return (
    <>
      <Heading title="Pacientes" lead={plural(patients.filter((item) => item.status === 'active').length, 'paciente em acompanhamento', 'pacientes em acompanhamento')}>
        <label className="search">
          <input type="search" placeholder="Buscar por nome, e-mail ou telefone" aria-label="Buscar paciente"
            value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <select className="input compact" aria-label="Situação" value={status} onChange={(event) => setStatus(event.target.value as PatientStatus | '')}>
          <option value="">Todas as situações</option>
          {Object.entries(patientStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        {manager && <button type="button" className="button" disabled={loading} onClick={() => setCreating(true)}>Novo paciente</button>}
      </Heading>

      <Panel title="Lista de pacientes">
        {visible.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nome</th><th>Telefone</th><th>Idade</th><th>Profissionais</th><th>Situação</th></tr></thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id} className="link">
                    <td>
                      <a href={`#/pacientes?id=${item.id}`}>{item.name}</a>
                      {(item.social_name || item.email) && <span className="sub">{item.social_name ? `Nome social: ${item.social_name}` : item.email}</span>}
                    </td>
                    <td>{item.phone || '—'}</td>
                    <td>{age(item.birth_date) ?? '—'}</td>
                    <td>{item.professional_ids.map((id) => names.get(id)).filter(Boolean).join(', ') || '—'}</td>
                    <td>{patientStatusLabel[item.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <PanelState error={error} loading={!data} empty={term || status ? 'Nenhum paciente encontrado com esses filtros.' : 'Nenhum paciente cadastrado.'} />
        )}
      </Panel>

      {creating && (
        <PatientForm professionals={professionals} onClose={() => setCreating(false)}
          onSaved={(id, message) => { notify(message); window.location.hash = `#/pacientes?id=${id}`; }} />
      )}
    </>
  );
}
