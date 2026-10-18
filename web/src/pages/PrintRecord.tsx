import logo from '../../../assets/logo.png';
import { api } from '../api.ts';
import { PanelState } from '../components/Page.tsx';
import { dateOnly, dateTime, longDay, time } from '../format.ts';
import { useLoad } from '../hooks.ts';

// Prontuário formal para imprimir ou salvar em PDF (pelo próprio navegador): evoluções finalizadas,
// retificações e conceitualização. Rascunhos e anotações pessoais ficam de fora.
// Abrir esta página registra uma exportação (função export_clinical_record).
export function PrintRecordPage({ patientId }: { patientId: string | null }) {
  const { data, error } = useLoad(() => (patientId ? api.exportClinicalRecord(patientId) : Promise.reject(new Error('Paciente não informado.'))), [patientId]);
  if (!data) return <PanelState error={error} loading={!error} empty="" />;

  return (
    <article className="print-record">
      <div className="print-actions no-print">
        <button type="button" className="button" onClick={() => window.print()}>Imprimir ou salvar em PDF</button>
        <span className="muted small">Esta exportação foi registrada.</span>
      </div>
      <header className="print-header">
        <img src={logo} alt="Renata de Azevedo, Psicologia e Coaching" />
        <div>
          <h1>Prontuário</h1>
          <p>{data.patient.name}{data.patient.birth_date ? `, nascimento em ${dateOnly(data.patient.birth_date)}` : ''}</p>
          <p className="muted">Profissional: {data.professional} · Exportado em {dateTime(data.exported_at)}</p>
        </div>
      </header>

      {data.formulation && (
        <section>
          <h2>Conceitualização de caso</h2>
          <p className="muted small">Modelo: {data.formulation.template_name} · atualizada em {dateTime(data.formulation.updated_at)}</p>
          {data.formulation.sections.filter((section) => data.formulation?.content[section.key]?.trim()).map((section) => (
            <div key={section.key} className="print-section">
              <h3>{section.label}</h3>
              <p>{data.formulation?.content[section.key]}</p>
            </div>
          ))}
        </section>
      )}

      <section>
        <h2>Evoluções</h2>
        {data.notes.length ? data.notes.map((note) => (
          <div key={note.id} className="print-section">
            <h3>
              {note.appointment_starts_at ? `Sessão de ${longDay(note.appointment_starts_at)}, ${time(note.appointment_starts_at)}` : 'Registro sem sessão vinculada'}
              {note.rectifies_id ? ' (retificação)' : ''}
            </h3>
            <p className="muted small">
              Finalizada em {dateTime(note.finalized_at)} por {data.professional}
              {note.rectifies_id && ` · motivo da retificação: ${note.rectification_reason}`}
            </p>
            <p>{note.body}</p>
          </div>
        )) : <p className="muted">Nenhuma evolução finalizada.</p>}
      </section>
      <footer className="print-footer muted small">
        Documento gerado pelo sistema da clínica. A identificação da profissional e as datas de finalização são registradas no sistema.
      </footer>
    </article>
  );
}
