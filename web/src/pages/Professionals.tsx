import { useState } from 'react';
import type { Professional } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { plural } from '../format.ts';
import { text, useLoad } from '../hooks.ts';

export function ProfessionalsPage() {
  const notify = useToast();
  // null: fechado; 'new': cadastro; Professional: edição.
  const [editing, setEditing] = useState<Professional | 'new' | null>(null);
  const { data, error, loading, reload } = useLoad(api.professionals, []);
  const professionals = data ?? [];
  const specialties = [...new Set(professionals.map((item) => item.specialty).filter((item): item is string => Boolean(item)))].sort();

  return (
    <>
      <Heading title="Profissionais" lead={plural(professionals.filter((item) => item.active).length, 'profissional em atividade', 'profissionais em atividade')}>
        <button type="button" className="button" disabled={loading} onClick={() => setEditing('new')}>Nova profissional</button>
      </Heading>

      <Panel title="Equipe">
        {professionals.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nome</th><th>Especialidade</th><th>E-mail</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {professionals.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.specialty || '—'}</td>
                    <td>{item.email || '—'}</td>
                    <td>{item.active ? 'Ativa' : 'Inativa'}</td>
                    <td className="actions-cell">
                      <button type="button" className="link-btn" aria-label={`Editar ${item.name}`} onClick={() => setEditing(item)}>Editar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhuma profissional cadastrada." />}
      </Panel>

      {editing && (
        <ProfessionalForm professional={editing === 'new' ? null : editing} specialties={specialties} onClose={() => setEditing(null)}
          onSaved={(message) => { notify(message); reload(); }} />
      )}
    </>
  );
}

interface ProfessionalFormProps {
  professional: Professional | null;
  specialties: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

function ProfessionalForm({ professional, specialties, onClose, onSaved }: ProfessionalFormProps) {
  return (
    <FormModal title={professional ? `Editar ${professional.name}` : 'Nova profissional'}
      submitLabel={professional ? 'Salvar' : 'Cadastrar profissional'} onClose={onClose} onSubmit={async (data) => {
        const input = { name: text(data, 'name'), email: text(data, 'email'), specialty: text(data, 'specialty') };
        if (professional) {
          await api.updateProfessional(professional.id, { ...input, active: data.get('active') === 'on' });
          onSaved('Profissional atualizada.');
        } else {
          await api.createProfessional(input);
          onSaved('Profissional cadastrada.');
        }
      }}>
      <Field label="Nome"><input className="input" name="name" required defaultValue={professional?.name} /></Field>
      <Field label="E-mail"><input className="input" name="email" type="email" defaultValue={professional?.email ?? ''} /></Field>
      <Field label="Especialidade" full>
        <input className="input" name="specialty" list="especialidades" placeholder="Ex.: Psicologia, Psiquiatria"
          defaultValue={professional?.specialty ?? ''} maxLength={80} />
        <datalist id="especialidades">{specialties.map((item) => <option key={item} value={item} />)}</datalist>
      </Field>
      {professional && (
        <label className="check full">
          <input type="checkbox" name="active" defaultChecked={professional.active} />
          <span>Em atividade<span className="sub">Profissionais inativas saem da agenda e dos cadastros novos; o histórico fica guardado.</span></span>
        </label>
      )}
    </FormModal>
  );
}
