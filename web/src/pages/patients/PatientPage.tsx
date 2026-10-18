import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Appointment, DocumentCategory, Patient, PatientDocument, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { ConfirmModal, Field } from '../../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import {
  age, dateKey, dateOnly, dateTime, documentCategoryLabel, fileSize, formatCpf, longDay, modalityLabel,
  patientStatusLabel, plural, sessionTypeLabel, statusLabel, time
} from '../../format.ts';
import { errorMessage, text, useFormSubmit, useLoad } from '../../hooks.ts';
import { PatientFinance } from './PatientFinance.tsx';
import { PatientForm } from './PatientForm.tsx';
import { PatientPortal } from './PatientPortal.tsx';

type Tab = 'geral' | 'sessoes' | 'documentos' | 'prontuario' | 'financeiro' | 'portal';
const TABS: [Tab, string][] = [
  ['geral', 'Visão geral'], ['sessoes', 'Sessões'], ['documentos', 'Documentos'], ['prontuario', 'Prontuário'], ['financeiro', 'Financeiro'],
  ['portal', 'Portal']
];

// Página central do paciente. O que aparece segue as permissões do banco: a profissional vê só os
// próprios pacientes e as próprias sessões; o prontuário só abre para a profissional responsável.
export function PatientPage({ user, patientId, initialTab }: { user: SessionUser; patientId: string; initialTab: string | null }) {
  const notify = useToast();
  const [tab, setTab] = useState<Tab>(TABS.some(([key]) => key === initialTab) ? initialTab as Tab : 'geral');
  const [editing, setEditing] = useState(false);
  const { data, error, loading, reload } = useLoad(() => Promise.all([
    api.patient(patientId), api.professionals(), api.patientAppointments(patientId)
  ]), [patientId]);
  const [patient, professionals, appointments] = data ?? [null, [], []];

  if (!data) return <PanelState error={error} loading={!data} empty="" />;
  if (!patient) {
    return (
      <>
        <a className="back" href="#/pacientes">Pacientes</a>
        <p className="notice">Paciente não encontrado ou fora da sua carteira.</p>
      </>
    );
  }

  const names = new Map(professionals.map((item) => [item.id, item.name]));
  const responsible = patient.professional_ids.map((id) => names.get(id)).filter(Boolean).join(', ');
  const years = age(patient.birth_date);
  const ownProfessional = user.roles.includes('professional') ? user.professional_id : null;
  const caresFor = Boolean(ownProfessional && patient.professional_ids.includes(ownProfessional));

  return (
    <>
      <a className="back" href="#/pacientes">Pacientes</a>
      <Heading title={patient.name}
        lead={[patient.social_name && `Nome social: ${patient.social_name}`, patientStatusLabel[patient.status],
          years !== null && plural(years, 'ano', 'anos'), responsible && `com ${responsible}`].filter(Boolean).join(' · ')}>
        {can(user, 'appointments.manage') && <a className="button light" href="#/agenda">Agendar sessão</a>}
        {can(user, 'patients.manage') && <button type="button" className="button" disabled={loading} onClick={() => setEditing(true)}>Editar cadastro</button>}
      </Heading>

      <div className="tabs patient-tabs" role="tablist" aria-label="Seções do paciente">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'tab on' : 'tab'}
            onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'geral' && <Overview patient={patient} responsible={responsible} />}
      {tab === 'sessoes' && <Sessions appointments={appointments} />}
      {tab === 'documentos' && <Documents patientId={patient.id} canManage={can(user, 'patients.manage')} />}
      {tab === 'prontuario' && (
        <Panel title="Prontuário">
          <div className="panel-body stack">
            {caresFor ? (
              <>
                <p>As evoluções ficam no prontuário, visível só para você entre as profissionais responsáveis.</p>
                <a className="button" href={`#/prontuarios?paciente=${patient.id}`}>Abrir prontuário</a>
              </>
            ) : (
              <p className="muted">O prontuário é visível apenas para a profissional responsável pelo atendimento. A gerência acompanha só as pendências, sem o conteúdo.</p>
            )}
          </div>
        </Panel>
      )}
      {tab === 'financeiro' && <PatientFinance user={user} patient={patient} />}
      {tab === 'portal' && <PatientPortal user={user} patient={patient} caresFor={caresFor} />}

      {editing && (
        <PatientForm patient={patient} professionals={professionals} onClose={() => setEditing(false)}
          onSaved={(_id, message) => { notify(message); reload(); }} />
      )}
    </>
  );
}

function Overview({ patient, responsible }: { patient: Patient; responsible: string }) {
  return (
    <div className="patient-overview">
      <Panel title="Cadastro">
        <div className="panel-body">
          <dl className="facts">
            <dt>Nascimento</dt><dd>{dateOnly(patient.birth_date)}</dd>
            <dt>CPF</dt><dd>{formatCpf(patient.cpf)}</dd>
            <dt>Telefone</dt><dd>{patient.phone || '—'}</dd>
            <dt>E-mail</dt><dd>{patient.email || '—'}</dd>
            <dt>Endereço</dt><dd>{patient.address || '—'}</dd>
            <dt>Cadastro</dt><dd>{dateOnly(patient.created_at)}</dd>
          </dl>
        </div>
      </Panel>
      <Panel title="Acompanhamento">
        <div className="panel-body">
          <dl className="facts">
            <dt>Situação</dt><dd>{patientStatusLabel[patient.status]}</dd>
            <dt>Profissionais</dt><dd>{responsible || '—'}</dd>
          </dl>
        </div>
      </Panel>
      {patient.guardian_name && (
        <Panel title="Responsável legal">
          <div className="panel-body">
            <dl className="facts">
              <dt>Nome</dt><dd>{patient.guardian_name}{patient.guardian_relationship && ` (${patient.guardian_relationship})`}</dd>
              <dt>Telefone</dt><dd>{patient.guardian_phone || '—'}</dd>
              <dt>E-mail</dt><dd>{patient.guardian_email || '—'}</dd>
            </dl>
          </div>
        </Panel>
      )}
      {patient.admin_notes && (
        <Panel title="Observações administrativas">
          <p className="panel-body pre">{patient.admin_notes}</p>
        </Panel>
      )}
    </div>
  );
}

function Sessions({ appointments }: { appointments: Appointment[] }) {
  const now = Date.now();
  const count = (status: Appointment['status']) => appointments.filter((item) => item.status === status).length;
  const upcoming = appointments.filter((item) => new Date(item.starts_at).getTime() > now
    && ['scheduled', 'awaiting_confirmation', 'confirmed'].includes(item.status)).length;

  return (
    <>
      <section className="numbers" aria-label="Resumo das sessões">
        <div className="number"><strong>{count('completed')}</strong><span>realizadas</span></div>
        <div className="number"><strong>{count('missed')}</strong><span>faltas</span></div>
        <div className="number"><strong>{count('cancelled_by_patient')}</strong><span>canceladas pelo paciente</span></div>
        <div className="number"><strong>{upcoming}</strong><span>próximas</span></div>
      </section>
      <Panel title="Histórico de sessões">
        {appointments.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Data</th><th>Horário</th><th>Profissional</th><th>Atendimento</th><th>Situação</th></tr></thead>
              <tbody>
                {appointments.map((item) => (
                  <tr key={item.id}>
                    <td><a href={`#/agenda?data=${dateKey(new Date(item.starts_at))}&sessao=${item.id}`}>{longDay(item.starts_at)}</a></td>
                    <td className="num-left">{time(item.starts_at)}–{time(item.ends_at)}</td>
                    <td>{item.professional_name}</td>
                    <td>{sessionTypeLabel[item.session_type]}, {modalityLabel[item.modality].toLowerCase()}</td>
                    <td><span className={`st st-${item.status}`}>{statusLabel[item.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error="" loading={false} empty="Nenhuma sessão registrada." />}
      </Panel>
    </>
  );
}

function Documents({ patientId, canManage }: { patientId: string; canManage: boolean }) {
  const notify = useToast();
  const { data, error, reload } = useLoad(() => api.patientDocuments(patientId), [patientId]);
  const [deleting, setDeleting] = useState<PatientDocument | null>(null);
  const [opening, setOpening] = useState('');
  const { busy, error: uploadError, onSubmit } = useFormSubmit(async (form) => {
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Escolha um arquivo.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB.');
    await api.uploadPatientDocument(patientId, file, text(form, 'title') || file.name, text(form, 'category') as DocumentCategory);
    notify('Documento enviado.');
    reload();
  });
  const documents = data ?? [];

  async function open(document: PatientDocument) {
    setOpening(document.id);
    // A aba é aberta já no clique (navegadores bloqueiam janelas abertas depois de uma espera).
    const tab = window.open('', '_blank');
    try {
      const url = await api.documentUrl(document);
      if (tab) tab.location.href = url; else window.location.href = url;
    } catch (failure) {
      tab?.close();
      notify(errorMessage(failure));
    } finally {
      setOpening('');
    }
  }

  return (
    <>
      {canManage && (
        <Panel title="Enviar documento">
          <form className="panel-body form-grid" onSubmit={onSubmit}>
            <Field label="Arquivo (PDF, imagem ou Word, até 10 MB)" full>
              <input className="input" name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" />
            </Field>
            <Field label="Título"><input className="input" name="title" maxLength={150} placeholder="Ex.: Contrato de atendimento" /></Field>
            <Field label="Tipo">
              <select className="input" name="category" defaultValue="contract">
                {Object.entries(documentCategoryLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            {uploadError && <p className="erro full" role="alert">{uploadError}</p>}
            <div className="full"><button type="submit" className="button" disabled={busy}>{busy ? 'Enviando…' : 'Enviar documento'}</button></div>
          </form>
        </Panel>
      )}
      <Panel title="Documentos administrativos">
        {documents.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Título</th><th>Tipo</th><th>Enviado em</th><th>Tamanho</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {documents.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{documentCategoryLabel[item.category]}</td>
                    <td>{dateTime(item.created_at)}</td>
                    <td>{fileSize(item.size_bytes)}</td>
                    <td className="actions-cell">
                      <button type="button" className="link-btn" disabled={opening === item.id} onClick={() => open(item)}>Abrir</button>
                      {canManage && <button type="button" className="link-btn danger" onClick={() => setDeleting(item)}>Excluir</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhum documento." />}
      </Panel>
      <p className="muted small">Documentos clínicos ficam no prontuário. Os links de abertura valem por 1 minuto.</p>

      {deleting && (
        <ConfirmModal title="Excluir documento" confirmLabel="Excluir documento" onClose={() => setDeleting(null)}
          onConfirm={async () => { await api.deletePatientDocument(deleting); notify('Documento excluído.'); reload(); }}>
          <p className="modal-text">Excluir <strong>{deleting.title}</strong>? O arquivo é apagado e não pode ser recuperado.</p>
        </ConfirmModal>
      )}
    </>
  );
}

