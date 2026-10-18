import { useState } from 'react';
import type { ClinicalDocument } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field } from '../../components/Modal.tsx';
import { Panel } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dateTime, fileSize } from '../../format.ts';
import { errorMessage, text, useFormSubmit } from '../../hooks.ts';

interface ClinicalDocumentsProps {
  patientId: string;
  professionalId: string;
  documents: ClinicalDocument[];
  onChanged: () => void;
}

// Documentos clínicos da profissional (laudos, escalas, relatórios). Ficam com a guarda do prontuário:
// não são excluídos. Cada abertura gera um link de 60 s e fica registrada.
export function ClinicalDocuments({ patientId, professionalId, documents, onChanged }: ClinicalDocumentsProps) {
  const notify = useToast();
  const [opening, setOpening] = useState('');
  const { busy, error, onSubmit } = useFormSubmit(async (form) => {
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Escolha um arquivo.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB.');
    await api.uploadClinicalDocument(patientId, professionalId, file, text(form, 'title') || file.name);
    notify('Documento clínico enviado.');
    onChanged();
  });

  async function open(document: ClinicalDocument) {
    setOpening(document.id);
    const tab = window.open('', '_blank');
    try {
      const url = await api.clinicalDocumentUrl(document.id);
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
      <Panel title="Enviar documento clínico">
        <form className="panel-body form-grid" onSubmit={onSubmit}>
          <Field label="Arquivo (PDF, imagem ou Word, até 10 MB)" full>
            <input className="input" name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" />
          </Field>
          <Field label="Título" full><input className="input" name="title" maxLength={150} placeholder="Ex.: Laudo, escala aplicada, relatório" /></Field>
          {error && <p className="erro full" role="alert">{error}</p>}
          <div className="full"><button type="submit" className="button" disabled={busy}>{busy ? 'Enviando…' : 'Enviar documento'}</button></div>
        </form>
      </Panel>
      <Panel title="Documentos clínicos">
        {documents.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Título</th><th>Enviado em</th><th>Tamanho</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {documents.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{dateTime(item.created_at)}</td>
                    <td>{fileSize(item.size_bytes)}</td>
                    <td className="actions-cell">
                      <button type="button" className="link-btn" disabled={opening === item.id} onClick={() => open(item)}>Abrir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty-state">Nenhum documento clínico.</p>}
      </Panel>
      <p className="muted small">Só você vê estes documentos. Eles seguem a guarda do prontuário e não podem ser excluídos.</p>
    </>
  );
}
