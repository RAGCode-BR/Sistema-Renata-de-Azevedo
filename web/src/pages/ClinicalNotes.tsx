import { Select } from '../components/Select.tsx';
import { useState } from 'react';
import type { SessionUser } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { patientStatusLabel } from '../format.ts';
import { useLoad } from '../hooks.ts';
import { ClinicalDocuments } from './record/ClinicalDocuments.tsx';
import { Evolutions } from './record/Evolutions.tsx';
import { Formulation } from './record/Formulation.tsx';
import { PersonalNotes } from './record/PersonalNotes.tsx';
import { Assistant } from './record/Assistant.tsx';
import { PatientFormResults } from './record/PatientFormResults.tsx';

type Tab = 'evolucoes' | 'conceitualizacao' | 'formularios' | 'documentos' | 'pessoais' | 'assistente';
const TABS: [Tab, string][] = [
  ['evolucoes', 'Evoluções'], ['conceitualizacao', 'Conceitualização'], ['formularios', 'Formulários'],
  ['documentos', 'Documentos clínicos'], ['pessoais', 'Anotações pessoais'],
  ['assistente', 'Assistente de IA']
];

// Prontuário da profissional. `patientId` e `appointmentId` vêm do endereço
// (#/prontuarios?paciente=…&sessao=…), usado pelos atalhos de pendência.
export function ClinicalNotesPage({ user, patientId: initialPatient, appointmentId }: {
  user: SessionUser; patientId: string | null; appointmentId: string | null;
}) {
  const [patientId, setPatientId] = useState(initialPatient ?? '');
  const { data: patients, error } = useLoad(api.patients, []);

  return (
    <>
      <Heading title="Prontuários" lead="Somente os seus registros clínicos. Cada abertura fica registrada.">
        {patientId && (
          <a className="button light" href={`#/prontuario-impressao?paciente=${patientId}`} target="_blank" rel="noopener">
            Exportar prontuário
          </a>
        )}
      </Heading>

      <Panel title="Paciente">
        <div className="panel-body">
          {error ? <p className="erro" role="alert">{error}</p> : (
            <label className="field">
              <span>Selecionar paciente</span>
              <Select className="input" value={patientId} onChange={(event) => setPatientId(event.target.value)}>
                <option value="">{patients ? 'Escolha' : 'Carregando…'}</option>
                {(patients ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}{item.status !== 'active' ? ` (${patientStatusLabel[item.status].toLowerCase()})` : ''}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
      </Panel>

      {patientId && user.professional_id && (
        <PatientRecord key={patientId} user={user} patientId={patientId} professionalId={user.professional_id}
          appointmentId={patientId === initialPatient ? appointmentId : null} />
      )}
    </>
  );
}

function PatientRecord({ user, patientId, professionalId, appointmentId }: { user: SessionUser; patientId: string; professionalId: string; appointmentId: string | null }) {
  const [tab, setTab] = useState<Tab>('evolucoes');
  // Uma leitura (registrada) por abertura do prontuário; as abas recarregam só depois de mudanças.
  const { data, error, reload } = useLoad(() => Promise.all([api.clinicalRecord(patientId), api.pendingNotes(), api.aiRuns(patientId).catch(() => [])]), [patientId]);

  if (!data) return <PanelState error={error} loading={!error} empty="" />;
  const [record, pending, aiRuns] = data;
  const aiNotes = new Set(aiRuns.map((item) => item.note_id).filter((id): id is string => Boolean(id)));

  return (
    <>
      <div className="tabs record-tabs" role="tablist" aria-label="Partes do prontuário">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'tab on' : 'tab'}
            onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'evolucoes' && (
        <Evolutions patientId={patientId} notes={record.notes.filter((note) => note.kind === 'evolution')}
          pending={pending.filter((item) => item.patient_id === patientId && item.professional_id === professionalId)}
          appointmentId={appointmentId} aiNotes={aiNotes} onChanged={reload} />
      )}
      {tab === 'conceitualizacao' && (
        <Formulation patientId={patientId} professionalId={professionalId} formulation={record.formulation} onChanged={reload} />
      )}
      {tab === 'formularios' && <PatientFormResults patientId={patientId} />}
      {tab === 'documentos' && (
        <ClinicalDocuments patientId={patientId} professionalId={professionalId} documents={record.documents} onChanged={reload} />
      )}
      {tab === 'assistente' && <Assistant user={user} patientId={patientId} onUsed={() => { reload(); setTab('evolucoes'); }} />}
      {tab === 'pessoais' && (
        <PersonalNotes patientId={patientId} notes={record.notes.filter((note) => note.kind === 'personal')} onChanged={reload} />
      )}
    </>
  );
}
