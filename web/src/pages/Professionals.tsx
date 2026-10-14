import { useState } from 'react';
import { api } from '../api.ts';
import { Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { plural } from '../format.ts';
import { text, useLoad } from '../hooks.ts';

export function ProfessionalsPage() {
  const notify = useToast();
  const [creating, setCreating] = useState(false);
  const { data, error, reload } = useLoad(api.professionals, []);
  const professionals = data ?? [];

  return (
    <>
      <Heading title="Profissionais" lead={plural(professionals.length, 'profissional', 'profissionais')}>
        <button type="button" className="button" onClick={() => setCreating(true)}>Nova profissional</button>
      </Heading>

      <Panel title="Equipe">
        {professionals.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nome</th><th>E-mail</th><th>Situação</th></tr></thead>
              <tbody>
                {professionals.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.email || '—'}</td>
                    <td>{item.active ? 'Ativa' : 'Inativa'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhuma profissional cadastrada." />}
      </Panel>

      {creating && (
        <FormModal title="Nova profissional" submitLabel="Cadastrar profissional" onClose={() => setCreating(false)}
          onSubmit={async (form) => {
            await api.createProfessional({ name: text(form, 'name'), email: text(form, 'email') });
            notify('Profissional cadastrada.');
            reload();
          }}>
          <Field label="Nome"><input className="input" name="name" required /></Field>
          <Field label="E-mail"><input className="input" name="email" type="email" /></Field>
        </FormModal>
      )}
    </>
  );
}
