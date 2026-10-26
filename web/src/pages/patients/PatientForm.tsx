import { useEffect, useRef, useState } from 'react';
import type { Patient, PatientInput, PatientStatus, Professional } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Select } from '../../components/Select.tsx';
import { Field, FormModal } from '../../components/Modal.tsx';
import { age, patientStatusLabel, validCpf } from '../../format.ts';
import { text, useLoad } from '../../hooks.ts';

type Props = { patient?: Patient; professionals: Professional[]; onClose: () => void; onSaved: (id: string, message: string) => void };
type Contact = Patient['additional_contacts'][number];
type Emergency = Patient['emergency_contacts'][number];
type Identity = Patient['identification_documents'][number];
const states = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const marital = [['single', 'Solteiro(a)'], ['married', 'Casado(a)'], ['stable_union', 'União estável'],
  ['divorced', 'Divorciado(a)'], ['widowed', 'Viúvo(a)'], ['other', 'Outro']];

export function PatientForm({ patient, professionals, onClose, onSaved }: Props) {
  const savedId = useRef<string | null>(patient?.id ?? null);
  const [birthDate, setBirthDate] = useState(patient?.birth_date?.slice(0, 10) ?? '');
  const minor = (age(birthDate) ?? 99) < 18;
  const [hasGuardian, setHasGuardian] = useState(Boolean(patient?.guardian_name));
  const showGuardian = minor || hasGuardian;
  const [tags, setTags] = useState(patient?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [contacts, setContacts] = useState<Contact[]>(patient?.additional_contacts ?? []);
  const [emergency, setEmergency] = useState<Emergency[]>(patient?.emergency_contacts ?? []);
  const [identities, setIdentities] = useState<Identity[]>(patient?.identification_documents ?? []);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [postalCode, setPostalCode] = useState(patient?.address_postal_code ?? '');
  const [address, setAddress] = useState({
    country: patient?.address_country ?? 'Brasil', state: patient?.address_state ?? '',
    city: patient?.address_city ?? '', district: patient?.address_district ?? '',
    street: patient?.address_street ?? '', number: patient?.address_number ?? '',
    complement: patient?.address_complement ?? ''
  });
  const [cepBusy, setCepBusy] = useState(false);
  const [cepError, setCepError] = useState('');
  const sources = useLoad(() => api.leadSources().catch(() => []), []).data ?? [];
  const options = professionals.filter((item) => item.active || patient?.professional_ids.includes(item.id));

  useEffect(() => {
    if (photo) {
      const url = URL.createObjectURL(photo);
      setPhotoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (patient?.photo_path) {
      let active = true;
      api.patientPhotoUrl(patient.photo_path).then((url) => { if (active) setPhotoUrl(url); }).catch(() => {});
      return () => { active = false; };
    }
  }, [photo, patient?.photo_path]);

  function addTag() {
    const next = tagDraft.trim().slice(0, 50);
    if (next && tags.length < 20 && !tags.some((tag) => tag.toLowerCase() === next.toLowerCase())) setTags([...tags, next]);
    setTagDraft('');
  }
  async function searchCep() {
    const cep = postalCode.replace(/\D/g, '');
    if (cep.length !== 8) { setCepError('Informe um CEP com 8 números.'); return; }
    setCepError(''); setCepBusy(true);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!response.ok) throw new Error('Não foi possível consultar o CEP.');
      const result = await response.json() as { erro?: boolean; uf?: string; localidade?: string; bairro?: string; logradouro?: string };
      if (result.erro) throw new Error('CEP não encontrado. Preencha o endereço manualmente.');
      setAddress((current) => ({ ...current, country: 'Brasil', state: result.uf ?? current.state,
        city: result.localidade ?? current.city, district: result.bairro ?? current.district,
        street: result.logradouro ?? current.street }));
    } catch (error) { setCepError(error instanceof Error ? error.message : 'Não foi possível consultar o CEP.'); }
    finally { setCepBusy(false); }
  }

  return <FormModal title={patient ? `Editar ${patient.name}` : 'Novo paciente'}
    submitLabel={patient ? 'Salvar cadastro' : 'Cadastrar paciente'} onClose={onClose}
    onSubmit={async (data) => {
      const professionalIds = data.getAll('professionalIds').map(String);
      if (!professionalIds.length) throw new Error('Selecione ao menos uma profissional responsável.');
      const cpf = text(data, 'cpf');
      if (cpf && !validCpf(cpf)) throw new Error('CPF inválido.');
      if (contacts.some((item) => !item.type || !item.number.trim())
        || emergency.some((item) => !item.relationship.trim() || !item.name.trim())
        || identities.some((item) => !item.type || !item.number.trim()))
        throw new Error('Preencha ou remova os contatos e documentos incompletos.');
      if (photo && (!['image/jpeg', 'image/png'].includes(photo.type) || photo.size > 2 * 1024 * 1024))
        throw new Error('A foto deve ser JPG ou PNG e ter até 2 MB.');
      if (files.some((file) => file.size > 10 * 1024 * 1024 || !/\.(pdf|jpe?g|png|webp|docx?)$/i.test(file.name)))
        throw new Error('Os anexos devem ser PDF, imagem ou Word, até 10 MB por arquivo.');
      const whatsapp = data.get('whatsapp') === 'on';
      if (whatsapp && text(data, 'phone').replace(/\D/g, '').length < 10)
        throw new Error('Para autorizar o WhatsApp, informe o celular com DDD.');
      if (postalCode && postalCode.replace(/\D/g, '').length !== 8)
        throw new Error('Informe um CEP com 8 números ou deixe o campo vazio.');
      const guardian = (key: string) => showGuardian ? text(data, key) : '';
      const input: PatientInput = {
        name: text(data, 'name'), social_name: text(data, 'social_name'), phone: text(data, 'phone'),
        email: text(data, 'email'), birth_date: birthDate, cpf, rg: text(data, 'rg'),
        sex: (text(data, 'sex') || null) as PatientInput['sex'],
        occupation: text(data, 'occupation'),
        marital_status: (text(data, 'marital_status') || null) as PatientInput['marital_status'],
        tags, additional_contacts: contacts, emergency_contacts: emergency, identification_documents: identities,
        address_country: address.country, address_postal_code: postalCode, address_state: address.state,
        address_city: address.city, address_district: address.district, address_street: address.street,
        address_number: address.number, address_complement: address.complement,
        address: [address.street, address.number, address.complement, address.district, address.city, address.state, postalCode]
          .filter(Boolean).join(', ') || (patient?.address ?? ''),
        guardian_name: guardian('guardian_name'), guardian_relationship: guardian('guardian_relationship'),
        guardian_phone: guardian('guardian_phone'), guardian_email: guardian('guardian_email'),
        admin_notes: text(data, 'admin_notes'), status: (text(data, 'status') || 'active') as PatientStatus,
        email_opt_in: data.get('email_opt_in') === 'on', sms_opt_in: data.get('sms_opt_in') === 'on', professionalIds
      };
      const id = await api.savePatient(savedId.current, input);
      savedId.current = id;
      const source = text(data, 'source') || null;
      if (sources.length && source !== (patient?.source_id ?? null)) await api.setPatientOrigin(id, source, patient?.campaign_id ?? null);
      if (whatsapp !== Boolean(patient?.whatsapp_opt_in)) await api.setPatientWhatsapp(id, whatsapp);
      if (photo) { await api.uploadPatientPhoto(id, photo); setPhoto(null); }
      for (const file of files) {
        await api.uploadPatientDocument(id, file, file.name, 'other');
        setFiles((current) => current.filter((item) => item !== file));
      }
      onSaved(id, patient ? 'Cadastro atualizado.' : 'Paciente cadastrado.');
    }}>
    <p className="patient-form-lead full">Preencha os dados disponíveis. Campos com * são obrigatórios.</p>
    <section className="patient-form-section full"><h3>Dados principais</h3><div className="form-grid">
      <div className="field"><span>Foto</span><label className="patient-photo-picker">
        {photoUrl ? <img src={photoUrl} alt="Foto do paciente" /> : <span className="patient-photo-avatar" aria-hidden="true">●</span>}
        <span><strong>Escolher foto</strong><small>JPG ou PNG · até 2 MB</small></span>
        <input type="file" accept="image/jpeg,image/png" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} />
      </label></div>
      <Field label="Nome *"><input className="input" name="name" required maxLength={200} placeholder="Nome e sobrenome" defaultValue={patient?.name} /></Field>
      <Field label="Nome social"><input className="input" name="social_name" maxLength={200} defaultValue={patient?.social_name ?? ''} /></Field>
      <Field label="E-mail"><input className="input" name="email" type="email" defaultValue={patient?.email ?? ''} /></Field>
      <Field label="Telefone"><input className="input" name="phone" type="tel" placeholder="(11) 99999-9999" defaultValue={patient?.phone ?? ''} /></Field>
      <Field label="Data de nascimento"><input className="input" name="birthDate" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></Field>
      <Field label="CPF"><input className="input" name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" defaultValue={patient?.cpf ?? ''} /></Field>
      <Field label="RG"><input className="input" name="rg" maxLength={30} defaultValue={patient?.rg ?? ''} /></Field>
      <Field label="Sexo"><Select className="input" name="sex" defaultValue={patient?.sex ?? ''}><option value="">Não informado</option>
        <option value="female">Feminino</option><option value="male">Masculino</option>
        <option value="other">Outro</option><option value="undisclosed">Prefere não informar</option>
      </Select></Field>
      <Field label="Situação"><Select className="input" name="status" defaultValue={patient?.status ?? 'active'}>
        {(Object.entries(patientStatusLabel) as [PatientStatus, string][]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select></Field>
    </div></section>

    <section className="patient-form-section full"><h3>Informações adicionais</h3><div className="form-grid">
      {sources.length > 0 && <Field label="Origem"><Select className="input" name="source" defaultValue={patient?.source_id ?? ''} key={sources.length}>
        <option value="">Não informada</option>{sources.filter((item) => item.active || item.id === patient?.source_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select></Field>}
      <Field label="Profissão"><input className="input" name="occupation" maxLength={120} defaultValue={patient?.occupation ?? ''} /></Field>
      <Field label="Estado civil"><Select className="input" name="marital_status" defaultValue={patient?.marital_status ?? ''}>
        <option value="">Não informado</option>{marital.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select></Field>
      <Field label="Observações administrativas" full><textarea className="input" name="admin_notes" rows={3} maxLength={2000}
        placeholder="Não registre informações clínicas aqui" defaultValue={patient?.admin_notes ?? ''} /></Field>
    </div><div className="field"><span>Etiquetas</span><div className="patient-tags">{tags.map((tag) => <button key={tag} type="button"
      className="patient-tag" onClick={() => setTags(tags.filter((item) => item !== tag))} aria-label={`Remover etiqueta ${tag}`}>{tag} ×</button>)}</div>
      <div className="patient-inline-add"><input className="input" aria-label="Nova etiqueta" maxLength={50} value={tagDraft}
        placeholder="Ex.: atendimento on-line" onChange={(event) => setTagDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} />
        <button type="button" className="button light" disabled={!tagDraft.trim() || tags.length >= 20} onClick={addTag}>Adicionar</button>
      </div></div></section>

    <details className="patient-form-section full" open><summary>Contatos adicionais</summary><div className="patient-repeat-list">
      {contacts.map((item, index) => <div className="patient-repeat-row" key={index}>
        <Field label="Tipo"><Select className="input" value={item.type} onChange={(event) => setContacts(contacts.map((entry, i) => i === index ? { ...entry, type: event.target.value } : entry))}>
          <option value="">Selecione</option><option value="mobile">Celular</option><option value="home">Residencial</option>
          <option value="work">Trabalho</option><option value="other">Outro</option></Select></Field>
        <Field label="Número"><input className="input" type="tel" value={item.number} onChange={(event) => setContacts(contacts.map((entry, i) => i === index ? { ...entry, number: event.target.value } : entry))} /></Field>
        <button type="button" className="link-btn danger" onClick={() => setContacts(contacts.filter((_, i) => i !== index))}>Remover</button>
      </div>)}
      {contacts.length < 10 && <button type="button" className="patient-add-row" onClick={() => setContacts([...contacts, { type: '', number: '' }])}>+ Adicionar contato</button>}
    </div></details>

    <details className="patient-form-section full" open><summary>Contatos de emergência</summary><div className="patient-repeat-list">
      {emergency.map((item, index) => <div className="patient-repeat-row emergency" key={index}>
        <Field label="Parentesco"><input className="input" value={item.relationship} onChange={(event) => setEmergency(emergency.map((entry, i) => i === index ? { ...entry, relationship: event.target.value } : entry))} /></Field>
        <Field label="Nome"><input className="input" value={item.name} onChange={(event) => setEmergency(emergency.map((entry, i) => i === index ? { ...entry, name: event.target.value } : entry))} /></Field>
        <Field label="Telefone"><input className="input" type="tel" value={item.phone} onChange={(event) => setEmergency(emergency.map((entry, i) => i === index ? { ...entry, phone: event.target.value } : entry))} /></Field>
        <button type="button" className="link-btn danger" onClick={() => setEmergency(emergency.filter((_, i) => i !== index))}>Remover</button>
      </div>)}
      {emergency.length < 10 && <button type="button" className="patient-add-row" onClick={() => setEmergency([...emergency, { relationship: '', name: '', phone: '' }])}>+ Adicionar contato de emergência</button>}
    </div></details>

    <details className="patient-form-section full" open><summary>Responsável legal</summary>
      {minor ? <p className="muted small">Obrigatório para pacientes menores de 18 anos.</p> :
        <label className="check"><input type="checkbox" checked={hasGuardian} onChange={(event) => setHasGuardian(event.target.checked)} /> Habilitar responsável</label>}
      {showGuardian && <div className="form-grid">
        <Field label="Nome do responsável"><input className="input" name="guardian_name" required={minor} defaultValue={patient?.guardian_name ?? ''} /></Field>
        <Field label="Parentesco"><input className="input" name="guardian_relationship" defaultValue={patient?.guardian_relationship ?? ''} /></Field>
        <Field label="Telefone do responsável"><input className="input" name="guardian_phone" type="tel" defaultValue={patient?.guardian_phone ?? ''} /></Field>
        <Field label="E-mail do responsável"><input className="input" name="guardian_email" type="email" defaultValue={patient?.guardian_email ?? ''} /></Field>
      </div>}
    </details>

    <details className="patient-form-section full" open><summary>Documentos de identificação</summary><div className="patient-repeat-list">
      {identities.map((item, index) => <div className="patient-repeat-row" key={index}>
        <Field label="Tipo"><Select className="input" value={item.type} onChange={(event) => setIdentities(identities.map((entry, i) => i === index ? { ...entry, type: event.target.value } : entry))}>
          <option value="">Selecione</option><option value="cnpj">CNPJ</option><option value="cnh">CNH</option>
          <option value="passport">Passaporte</option><option value="other">Outro</option></Select></Field>
        <Field label="Número"><input className="input" value={item.number} onChange={(event) => setIdentities(identities.map((entry, i) => i === index ? { ...entry, number: event.target.value } : entry))} /></Field>
        <button type="button" className="link-btn danger" onClick={() => setIdentities(identities.filter((_, i) => i !== index))}>Remover</button>
      </div>)}
      {identities.length < 10 && <button type="button" className="patient-add-row" onClick={() => setIdentities([...identities, { type: '', number: '' }])}>+ Adicionar documento</button>}
    </div></details>

    <details className="patient-form-section full" open><summary>Notificações</summary>
      <p className="muted small">Marque apenas os canais autorizados pelo paciente. O envio depende das integrações configuradas.</p>
      <div className="patient-notifications">
        <label className="check"><input type="checkbox" name="email_opt_in" defaultChecked={patient?.email_opt_in ?? false} /> E-mail</label>
        <label className="check"><input type="checkbox" name="sms_opt_in" defaultChecked={patient?.sms_opt_in ?? false} /> SMS</label>
        <label className="check"><input type="checkbox" name="whatsapp" defaultChecked={patient?.whatsapp_opt_in ?? false} /> WhatsApp</label>
      </div>
    </details>

    <details className="patient-form-section full" open><summary>Endereço</summary><div className="form-grid">
      <Field label="País"><input className="input" value={address.country} onChange={(event) => setAddress({ ...address, country: event.target.value })} /></Field>
      <div className="field"><span>CEP <button type="button" className="patient-cep-link" disabled={cepBusy || address.country !== 'Brasil'} onClick={searchCep}>{cepBusy ? 'Buscando…' : 'Buscar CEP'}</button></span>
        <input className="input" inputMode="numeric" maxLength={9} placeholder="00000-000" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} />
        {cepError && <span className="erro small" role="alert">{cepError}</span>}
      </div>
      <Field label="Estado"><Select className="input" value={address.state} onChange={(event) => setAddress({ ...address, state: event.target.value })}>
        <option value="">Selecione</option>{states.map((state) => <option key={state} value={state}>{state}</option>)}</Select></Field>
      <Field label="Cidade"><input className="input" value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })} /></Field>
      <Field label="Bairro"><input className="input" value={address.district} onChange={(event) => setAddress({ ...address, district: event.target.value })} /></Field>
      <Field label="Rua"><input className="input" value={address.street} onChange={(event) => setAddress({ ...address, street: event.target.value })} /></Field>
      <Field label="Número"><input className="input" value={address.number} onChange={(event) => setAddress({ ...address, number: event.target.value })} /></Field>
      <Field label="Complemento"><input className="input" value={address.complement} onChange={(event) => setAddress({ ...address, complement: event.target.value })} /></Field>
    </div></details>

    <details className="patient-form-section full" open><summary>Anexos</summary>
      <label className="patient-upload-area"><strong>Escolher arquivos</strong><span>PDF, imagem ou Word · até 10 MB por arquivo</span>
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} />
      </label>
      {files.length > 0 && <ul className="patient-file-list">{files.map((file) => <li key={file.name}>{file.name}</li>)}</ul>}
      {patient && <p className="muted small">Arquivos já enviados estão na aba Documentos da ficha do paciente.</p>}
    </details>

    <section className="patient-form-section full"><h3>Profissionais responsáveis</h3><div className="patient-professional-list" role="group" aria-label="Profissionais responsáveis">
      {options.length ? options.map((item) => <label key={item.id} className="check">
        <input type="checkbox" name="professionalIds" value={item.id} defaultChecked={patient?.professional_ids.includes(item.id)} />
        {item.name}{!item.active && ' (inativa)'}</label>) : <p className="muted small">Cadastre uma profissional antes.</p>}
    </div>{patient && <p className="muted small">Remover uma profissional encerra o acesso dela a este paciente. Os registros clínicos continuam preservados.</p>}
    </section>
  </FormModal>;
}
