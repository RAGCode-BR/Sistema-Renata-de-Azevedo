import { useState } from 'react';
import type { Professional, SessionUser } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { dateOnly, plural } from '../format.ts';
import { text, useLoad } from '../hooks.ts';

export function PatientsPage({ user }: { user: SessionUser }) {
  const admin = user.role === 'admin';
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const { data, error, reload } = useLoad(() => Promise.all([api.patients(), api.professionals()]), []);
  const [patients, professionals] = data ?? [[], []];
  const names = new Map(professionals.map((item) => [item.id, item.name]));
  const term = search.trim().toLocaleLowerCase('pt-BR');
  const visible = term ? patients.filter((item) => item.name.toLocaleLowerCase('pt-BR').includes(term)) : patients;

  return (
    <>
      <Heading title="Pacientes" lead={plural(patients.length, 'cadastro', 'cadastros')}>
        <label className="search">
          <input type="search" placeholder="Buscar por nome" aria-label="Buscar paciente por nome"
            value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {admin && <button type="button" className="button" onClick={() => setCreating(true)}>Novo paciente</button>}
      </Heading>

      <Panel title="Lista de pacientes">
        {visible.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Nome</th><th>Telefone</th><th>Nascimento</th><th>Profissionais</th><th>Situação</th></tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}{item.email && <span className="sub">{item.email}</span>}</td>
                    <td>{item.phone || '—'}</td>
                    <td>{dateOnly(item.birth_date)}</td>
                    <td>{item.professional_ids.map((id) => names.get(id)).filter(Boolean).join(', ') || '—'}</td>
                    <td>{item.status === 'active' ? 'Ativo' : 'Encerrado'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <PanelState error={error} loading={!data} empty={term ? 'Nenhum paciente encontrado.' : 'Nenhum paciente cadastrado.'} />
        )}
      </Panel>

      {creating && (
        <PatientForm professionals={professionals} onClose={() => setCreating(false)}
          onSaved={() => { notify('Paciente cadastrado.'); reload(); }} />
      )}
    </>
  );
}

function PatientForm({ professionals, onClose, onSaved }: { professionals: Professional[]; onClose: () => void; onSaved: () => void }) {
  const active = professionals.filter((item) => item.active);

  return (
    <FormModal title="Novo paciente" submitLabel="Cadastrar paciente" onClose={onClose} onSubmit={async (data) => {
      const professionalIds = data.getAll('professionalIds').map(String);
      if (!professionalIds.length) throw new Error('Selecione ao menos uma profissional responsável.');
      await api.createPatient({
        name: text(data, 'name'),
        phone: text(data, 'phone'),
        email: text(data, 'email'),
        birthDate: text(data, 'birthDate'),
        professionalIds
      });
      onSaved();
    }}>
      <Field label="Nome" full><input className="input" name="name" required /></Field>
      <Field label="Telefone"><input className="input" name="phone" type="tel" autoComplete="off" /></Field>
      <Field label="E-mail"><input className="input" name="email" type="email" autoComplete="off" /></Field>
      <Field label="Nascimento"><input className="input" name="birthDate" type="date" /></Field>
      <fieldset className="full checks">
        <legend>Profissionais responsáveis</legend>
        {active.length ? active.map((item) => (
          <label key={item.id} className="check">
            <input type="checkbox" name="professionalIds" value={item.id} />
            {item.name}
          </label>
        )) : <p className="muted small">Cadastre uma profissional antes.</p>}
      </fieldset>
    </FormModal>
  );
}
