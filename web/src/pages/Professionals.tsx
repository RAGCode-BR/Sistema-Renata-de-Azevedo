import { useEffect, useRef, useState } from 'react';
import { can } from '../../../shared/permissions.ts';
import { MIN_PASSWORD_LENGTH } from '../../../shared/rules.ts';
import type { NewProfessional, Professional, ProfessionalDocument, SessionUser, UserAccount } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { ConfirmModal, Field, FormModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { Select } from '../components/Select.tsx';
import { useToast } from '../components/Toast.tsx';
import { plural } from '../format.ts';
import { errorMessage, secret, text, useLoad } from '../hooks.ts';

const COLORS = [
  ['#7D4B62', 'Vinho suave'], ['#53102F', 'Vinho'], ['#A46778', 'Rosa'],
  ['#5C7890', 'Azul'], ['#5B806B', 'Verde'], ['#B98D6C', 'Dourado'], ['#756690', 'Roxo']
];
const FILE_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif|jfif|pdf|txt|docx?|xlsx?|ogg|mp4|mov)$/i;

export function ProfessionalsPage({ user }: { user: SessionUser }) {
  const notify = useToast();
  const managesUsers = can(user, 'users.manage');
  const [editing, setEditing] = useState<Professional | 'new' | null>(null);
  const { data, error, loading, reload } = useLoad(() => Promise.all([
    api.professionals(), managesUsers ? api.users() : Promise.resolve([] as UserAccount[])
  ]), [managesUsers]);
  const [professionals, accounts] = data ?? [[], []];

  return <>
    <Heading title="Profissionais" lead={plural(professionals.filter((item) => item.active).length, 'profissional em atividade', 'profissionais em atividade')}>
      <button type="button" className="button" disabled={loading} onClick={() => setEditing('new')}>Nova profissional</button>
    </Heading>
    <Panel title="Equipe">
      {professionals.length ? <div className="table-wrap"><table className="table">
        <thead><tr><th>Nome</th><th>Especialidade</th><th>E-mail</th><th>Situação</th><th><span className="sr-only">Ações</span></th></tr></thead>
        <tbody>{professionals.map((item) => <tr key={item.id}>
          <td><span className="professional-list-name"><span className="professional-color-dot" style={{ background: item.color }} />{item.name}</span>
            {item.tags.length > 0 && <span className="sub">{item.tags.join(' · ')}</span>}</td>
          <td>{item.specialty || '—'}</td><td>{item.email || '—'}</td><td>{item.active ? 'Ativa' : 'Inativa'}</td>
          <td className="actions-cell"><button type="button" className="link-btn" aria-label={`Editar ${item.name}`} onClick={() => setEditing(item)}>Editar</button></td>
        </tr>)}</tbody>
      </table></div> : <PanelState error={error} loading={!data} empty="Nenhuma profissional cadastrada." />}
    </Panel>
    {editing && <ProfessionalForm professional={editing === 'new' ? null : editing}
      account={editing === 'new' ? null : accounts.find((item) => item.professional_id === editing.id) ?? null}
      managesUsers={managesUsers} onClose={() => setEditing(null)} onSaved={(message) => { notify(message); reload(); }} />}
  </>;
}

function ProfessionalForm({ professional, account, managesUsers, onClose, onSaved }: {
  professional: Professional | null; account: UserAccount | null; managesUsers: boolean;
  onClose: () => void; onSaved: (message: string) => void;
}) {
  const savedId = useRef<string | null>(professional?.id ?? null);
  const [tags, setTags] = useState(professional?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [color, setColor] = useState(professional?.color ?? COLORS[0][0]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [hasAccess, setHasAccess] = useState(Boolean(account?.active));
  const [documentError, setDocumentError] = useState('');
  const [deleting, setDeleting] = useState<ProfessionalDocument | null>(null);
  const documents = useLoad(() => professional ? api.professionalDocuments(professional.id) : Promise.resolve([] as ProfessionalDocument[]), [professional?.id]);

  useEffect(() => {
    if (photo) {
      const url = URL.createObjectURL(photo);
      setPhotoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (professional?.photo_path) {
      let active = true;
      api.professionalPhotoUrl(professional.photo_path).then((url) => { if (active) setPhotoUrl(url); }).catch(() => {});
      return () => { active = false; };
    }
  }, [photo, professional?.photo_path]);

  function addTag() {
    const next = tagDraft.trim().slice(0, 50);
    if (next && tags.length < 20 && !tags.some((tag) => tag.toLocaleLowerCase('pt-BR') === next.toLocaleLowerCase('pt-BR')))
      setTags([...tags, next]);
    setTagDraft('');
  }
  function addFiles(list: FileList | null) {
    if (!list) return;
    const selected = Array.from(list);
    setFiles((current) => [...current, ...selected]);
  }

  return <>
    <FormModal title={professional ? `Editar ${professional.name}` : 'Nova profissional'}
      submitLabel={professional ? 'Salvar cadastro' : 'Cadastrar profissional'} onClose={onClose} onSubmit={async (data) => {
        if (photo && (!['image/jpeg', 'image/png'].includes(photo.type) || photo.size > 2 * 1024 * 1024))
          throw new Error('A foto deve ser JPG ou PNG e ter até 2 MB.');
        if (files.some((file) => !FILE_EXTENSIONS.test(file.name) || file.size < 1 || file.size > 10 * 1024 * 1024))
          throw new Error('Use anexos dos tipos mostrados, com até 10 MB por arquivo.');
        const input: NewProfessional = { name: text(data, 'name'), email: text(data, 'email'), specialty: text(data, 'specialty'),
          tags, color, commission_sales: data.get('commission_sales') === 'on',
          commission_sessions: data.get('commission_sessions') === 'on', uses_clinic_hours: data.get('uses_clinic_hours') === 'on' };
        if (savedId.current) await api.updateProfessional(savedId.current, { ...input, active: professional ? data.get('active') === 'on' : true });
        else savedId.current = (await api.createProfessional(input)).id;
        const id = savedId.current;
        if (photo) { await api.uploadProfessionalPhoto(id, photo); setPhoto(null); }
        for (const file of files) {
          await api.uploadProfessionalDocument(id, file);
          setFiles((current) => current.filter((item) => item !== file));
        }
        if (managesUsers) {
          if (account && account.active !== hasAccess)
            await api.updateUserAccess({ userId: account.id, roles: account.roles, professionalId: id, active: hasAccess });
          else if (!account && hasAccess) {
            try { await api.createUser({ name: input.name, email: input.email, roles: ['professional'], professionalId: id,
              password: secret(data, 'password') }); }
            catch (failure) { throw new Error(`Cadastro salvo, mas o acesso não foi criado: ${errorMessage(failure)}`); }
          }
        }
        onSaved(professional ? 'Profissional atualizada.' : 'Profissional cadastrada.');
      }}>
      <p className="patient-form-lead full">Campos com * são obrigatórios. Os anexos ficam visíveis apenas para quem gerencia profissionais.</p>
      <section className="professional-form-section full"><div className="form-grid">
        <div className="field"><span>Foto</span><label className="patient-photo-picker">
          {photoUrl ? <img src={photoUrl} alt="Foto da profissional" /> : <span className="patient-photo-avatar" aria-hidden="true">●</span>}
          <span><strong>Escolher foto</strong><small>JPG ou PNG · até 2 MB</small></span>
          <input type="file" accept="image/jpeg,image/png" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
        </label></div>
        <Field label="Nome *"><input className="input" name="name" required maxLength={200} placeholder="Nome e sobrenome" defaultValue={professional?.name} /></Field>
        <Field label="E-mail *"><input className="input" name="email" type="email" required maxLength={255} placeholder="E-mail" defaultValue={professional?.email ?? ''} /></Field>
        <Field label="Cor *"><div className="professional-color-control"><span className="professional-color-preview" style={{ background: color }} />
          <Select className="input" name="color" value={color} onChange={(event) => setColor(event.target.value)}>
            {COLORS.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </Select></div></Field>
        <div className="field full"><span>Etiquetas</span><div className="patient-tags">{tags.map((tag) =>
          <button key={tag} type="button" className="patient-tag" onClick={() => setTags(tags.filter((item) => item !== tag))}
            aria-label={`Remover etiqueta ${tag}`}>{tag} ×</button>)}</div>
          <div className="patient-inline-add"><input className="input" aria-label="Nova etiqueta" maxLength={50} value={tagDraft}
            placeholder="Ex.: Psicologia infantil" onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} />
            <button type="button" className="button light" disabled={!tagDraft.trim() || tags.length >= 20} onClick={addTag}>+ Adicionar</button>
          </div></div>
        <Field label="Especialidade" full><input className="input" name="specialty"
          placeholder="Ex.: Psicologia" defaultValue={professional?.specialty ?? ''} maxLength={80} /></Field>
        {professional && <label className="check full"><input type="checkbox" name="active" defaultChecked={professional.active} />
          <span>Em atividade<span className="sub">Profissionais inativas saem de novos agendamentos; o histórico permanece.</span></span></label>}
      </div></section>

      <section className="professional-form-section full"><h3>Perfil e permissões</h3>
        <label className="professional-switch"><input type="checkbox" name="access" checked={hasAccess} disabled={!managesUsers}
          onChange={(event) => setHasAccess(event.target.checked)} /><span>Possui acesso ao sistema?</span></label>
        {!managesUsers && <p className="professional-section-note">Somente a Proprietária pode criar ou alterar o acesso. Use a página Usuários.</p>}
        {managesUsers && hasAccess && !account && <Field label={`Senha inicial * (mínimo de ${MIN_PASSWORD_LENGTH} caracteres)`} full>
          <input className="input" name="password" type="password" minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password" required placeholder="Defina a senha inicial" />
        </Field>}
        {account && <p className="professional-section-note">Conta vinculada: {account.email}. Alterar o e-mail deste cadastro não muda o e-mail de login.</p>}
      </section>

      <section className="professional-form-section full"><h3>Comissões padrão</h3><div className="professional-switch-grid">
        <label className="professional-switch"><input type="checkbox" name="commission_sales" defaultChecked={professional?.commission_sales ?? false} /><span>Comissionar vendas</span></label>
        <label className="professional-switch"><input type="checkbox" name="commission_sessions" defaultChecked={professional?.commission_sessions ?? false} /><span>Comissionar atendimentos</span></label>
      </div><p className="professional-section-note">O percentual de repasse por atendimento é definido em Financeiro → Repasses. A comissão por vendas ainda não tem cálculo automático.</p></section>

      <section className="professional-form-section full"><h3>Horário de Atendimento</h3>
        <label className="professional-switch"><input type="checkbox" name="uses_clinic_hours" defaultChecked={professional?.uses_clinic_hours ?? true} /><span>Igual ao da clínica</span></label>
        <p className="professional-section-note">A escala de horários ainda não está cadastrada; a disponibilidade considera sessões e bloqueios da agenda.</p>
      </section>

      <section className="professional-form-section full"><h3>Anexos</h3>
        <label className="patient-upload-area professional-upload-area" onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }}>
          <strong aria-hidden="true">⇧</strong><span>Arraste e solte arquivos aqui</span>
          <span>PDF, imagem, texto, Word, Excel, áudio ou vídeo · até 10 MB por arquivo</span>
          <b>Escolher arquivos</b><input type="file" multiple accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.jfif,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ogg,.mp4,.mov"
            onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
        </label>
        {files.length > 0 && <ul className="professional-file-list">{files.map((file, index) => <li key={`${file.name}-${index}`}>
          <span>{file.name}</span><button type="button" className="link-btn danger" onClick={() => setFiles(files.filter((_, i) => i !== index))}>Remover</button>
        </li>)}</ul>}
        {documents.data && documents.data.length > 0 && <ul className="professional-file-list">{documents.data.map((document) => <li key={document.id}>
          <span>{document.title}</span><button type="button" className="link-btn" onClick={async () => {
            const opened = window.open('', '_blank');
            try {
              const url = await api.professionalDocumentUrl(document.storage_path);
              if (opened) { opened.opener = null; opened.location.href = url; }
              else window.location.href = url;
            } catch (failure) { opened?.close(); setDocumentError(errorMessage(failure)); }
          }}>Abrir</button><button type="button" className="link-btn danger" onClick={() => setDeleting(document)}>Excluir</button>
        </li>)}</ul>}
        {documents.error && <p className="erro" role="alert">{documents.error}</p>}
        {documentError && <p className="erro" role="alert">{documentError}</p>}
      </section>
    </FormModal>
    {deleting && <ConfirmModal title="Excluir anexo" confirmLabel="Excluir anexo" onClose={() => setDeleting(null)} onConfirm={async () => {
      await api.deleteProfessionalDocument(deleting); documents.reload();
    }}><p>Excluir “{deleting.title}” definitivamente?</p></ConfirmModal>}
  </>;
}
