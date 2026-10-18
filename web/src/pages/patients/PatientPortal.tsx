import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Patient, PortalAccess, PortalRelationship, PortalSharedDocument, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { ConfirmModal, Field } from '../../components/Modal.tsx';
import { Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { age, dateOnly, dateTime, fileSize } from '../../format.ts';
import { errorMessage, text, useFormSubmit, useLoad } from '../../hooks.ts';

const REQUEST: Record<string, string> = { reschedule: 'Remarcar sessão', cancel: 'Cancelar sessão', paid: 'Avisou pagamento' };
const TASK: Record<string, string> = { todo: 'tarefa a fazer', doing: 'tarefa em andamento', done: 'tarefa concluída', cancelled: 'tarefa cancelada' };

// Aba "Portal" da ficha: quem acessa (convite e revogação), documentos compartilhados e pedidos feitos
// pelo paciente. Convidar e revogar: quem gerencia pacientes. Compartilhar: também a profissional responsável.
export function PatientPortal({ user, patient, caresFor }: { user: SessionUser; patient: Patient; caresFor: boolean }) {
  const notify = useToast();
  const canManage = can(user, 'patients.manage');
  const canShare = canManage || caresFor;
  const { data, error, reload } = useLoad(() => Promise.all([
    api.portalAccessList(patient.id), api.portalSharedDocuments(patient.id), api.portalRequests(patient.id), api.settings()
  ]), [patient.id]);
  const [accesses, documents, requests, settings] = data ?? [[], [], [], null];
  const [revoking, setRevoking] = useState<PortalAccess | null>(null);
  const [removing, setRemoving] = useState<PortalSharedDocument | null>(null);
  const [opening, setOpening] = useState('');
  const minor = (age(patient.birth_date) ?? 99) < 18;
  const [relationship, setRelationship] = useState<PortalRelationship>(minor ? 'guardian' : 'self');
  const active = accesses.filter((item) => !item.revoked_at);
  const portalUrl = settings?.portal_url || `${window.location.origin}/#/portal`;
  // Sugere o e-mail do cadastro, a não ser que ele já tenha acesso.
  const registered = ((relationship === 'guardian' ? patient.guardian_email : patient.email) ?? '').trim().toLowerCase();
  const suggested = active.some((item) => item.email.toLowerCase() === registered) ? '' : registered;

  const invite = useFormSubmit(async (form) => {
    const result = await api.portalInvite(patient.id, text(form, 'email'), relationship);
    notify(result.created ? 'Acesso criado. Envie o endereço do portal para a pessoa.' : 'Acesso liberado para a conta que já existia.');
    reload();
  });
  const share = useFormSubmit(async (form) => {
    const file = form.get('file');
    if (!(file instanceof File) || !file.size) throw new Error('Escolha um arquivo.');
    if (file.size > 10 * 1024 * 1024) throw new Error('Arquivo maior que 10 MB.');
    await api.sharePortalDocument(patient.id, file, text(form, 'title') || file.name.replace(/\.[^.]+$/, ''));
    notify('Documento compartilhado com o paciente.');
    reload();
  });

  async function open(id: string) {
    setOpening(id);
    const tab = window.open('', '_blank');
    try {
      const url = await api.portalDocumentUrl(id);
      if (tab) tab.location.href = url; else window.location.href = url;
    } catch (failure) {
      tab?.close();
      notify(errorMessage(failure));
    } finally {
      setOpening('');
    }
  }

  if (!data) return <PanelState error={error} loading={!error} empty="" />;

  return (
    <>
      {!settings?.portal_enabled && (
        <p className="notice">O portal do paciente está desligado. Quem gerencia as configurações liga em Configurações → Portal do paciente.</p>
      )}
      <Panel title="Acesso ao portal">
        {accesses.length ? (
          <ul className="portal-access-list">
            {accesses.map((item) => (
              <li key={item.id} className={item.revoked_at ? 'revoked' : undefined}>
                <div>
                  <strong>{item.name}</strong> · {item.email}
                  <span className="sub">
                    {item.relationship === 'guardian' ? 'Responsável' : 'O próprio paciente'} · convidado em {dateOnly(item.invited_at)}
                    {item.invited_by_name && ` por ${item.invited_by_name}`}
                    {item.revoked_at ? ` · acesso encerrado em ${dateOnly(item.revoked_at)}`
                      : item.last_sign_in_at ? ` · último acesso ${dateTime(item.last_sign_in_at)}` : ' · ainda não entrou'}
                    {!item.revoked_at && item.terms_accepted_at && ` · aceitou os termos em ${dateOnly(item.terms_accepted_at)}`}
                  </span>
                </div>
                {canManage && !item.revoked_at && <button type="button" className="link-btn danger" onClick={() => setRevoking(item)}>Encerrar acesso</button>}
              </li>
            ))}
          </ul>
        ) : <p className="empty-state">Ninguém tem acesso ao portal deste paciente.</p>}
        {canManage && (
          <form className="panel-body form-grid" onSubmit={invite.onSubmit}
            key={`${relationship}-${active.length}`}>
            <Field label="Quem vai acessar">
              <select className="input" value={relationship} onChange={(event) => setRelationship(event.target.value as PortalRelationship)}>
                <option value="self" disabled={minor}>O próprio paciente</option>
                <option value="guardian">Responsável</option>
              </select>
            </Field>
            <Field label="E-mail">
              <input className="input" name="email" type="email" required defaultValue={suggested} />
            </Field>
            <p className="muted small full">
              {minor ? 'Paciente menor de 18 anos: o acesso é do responsável. ' : ''}
              A pessoa entra com um código enviado a este e-mail, sem senha. Depois do convite, envie o endereço do portal: <strong>{portalUrl}</strong>
            </p>
            {invite.error && <p className="erro full" role="alert">{invite.error}</p>}
            <div className="full"><button type="submit" className="button" disabled={invite.busy}>
              {invite.busy ? 'Liberando…' : active.length ? 'Liberar acesso para outra pessoa' : 'Liberar acesso ao portal'}</button></div>
          </form>
        )}
      </Panel>

      <Panel title="Documentos compartilhados no portal">
        {canShare && (
          <form className="panel-body form-grid" onSubmit={share.onSubmit}>
            <Field label="Arquivo (PDF, JPG, PNG ou Word .docx, até 10 MB)" full>
              <input className="input" name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.docx" />
            </Field>
            <Field label="Título que o paciente vai ver" full>
              <input className="input" name="title" maxLength={200} placeholder="Ex.: Declaração de comparecimento" />
            </Field>
            <p className="muted small full">O paciente vê o documento assim que ele é enviado. Não compartilhe documentos do prontuário por aqui.</p>
            {share.error && <p className="erro full" role="alert">{share.error}</p>}
            <div className="full"><button type="submit" className="button" disabled={share.busy}>{share.busy ? 'Enviando…' : 'Compartilhar com o paciente'}</button></div>
          </form>
        )}
        {documents.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Título</th><th>Compartilhado</th><th>Tamanho</th><th>Aberto pelo paciente</th><th><span className="sr-only">Ações</span></th></tr></thead>
              <tbody>
                {documents.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{dateOnly(item.created_at)}{item.shared_by_name && ` · ${item.shared_by_name}`}</td>
                    <td>{fileSize(item.size_bytes)}</td>
                    <td>{item.first_download_at ? `${dateTime(item.first_download_at)}${item.downloads > 1 ? ` (${item.downloads} vezes)` : ''}` : 'Ainda não'}</td>
                    <td className="actions-cell">
                      <button type="button" className="link-btn" disabled={opening === item.id} onClick={() => open(item.id)}>Abrir</button>
                      {item.can_remove && <button type="button" className="link-btn danger" onClick={() => setRemoving(item)}>Remover</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty-state">Nenhum documento compartilhado.</p>}
      </Panel>

      <Panel title="Pedidos feitos pelo portal">
        {requests.length ? (
          <ul className="portal-access-list">
            {requests.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{REQUEST[item.kind]}</strong>
                  {item.appointment_starts_at && ` · sessão de ${dateTime(item.appointment_starts_at)}`}
                  {item.charge_description && ` · ${item.charge_description}`}
                  <span className="sub">
                    {dateTime(item.created_at)}{item.requested_by && ` · ${item.requested_by}`}{item.task_status && ` · ${TASK[item.task_status]}`}
                    {item.message && ` · "${item.message}"`}
                  </span>
                </div>
                {item.task_id && <a className="link-btn" href={`#/tarefas?tarefa=${item.task_id}`}>Ver tarefa</a>}
              </li>
            ))}
          </ul>
        ) : <p className="empty-state">Nenhum pedido.</p>}
      </Panel>

      {revoking && (
        <ConfirmModal title="Encerrar acesso ao portal" confirmLabel="Encerrar acesso" onClose={() => setRevoking(null)}
          onConfirm={async () => { await api.revokePortalAccess(revoking.id); notify('Acesso encerrado.'); reload(); }}>
          <p className="modal-text"><strong>{revoking.name}</strong> ({revoking.email}) deixa de ver as sessões, cobranças e documentos deste paciente imediatamente. Dá para convidar de novo depois.</p>
        </ConfirmModal>
      )}
      {removing && (
        <ConfirmModal title="Remover documento do portal" confirmLabel="Remover documento" onClose={() => setRemoving(null)}
          onConfirm={async () => { await api.removePortalDocument(removing.id); notify('Documento removido do portal.'); reload(); }}>
          <p className="modal-text">Remover <strong>{removing.title}</strong>? O paciente deixa de ver o documento e o arquivo é apagado.</p>
        </ConfirmModal>
      )}
    </>
  );
}
