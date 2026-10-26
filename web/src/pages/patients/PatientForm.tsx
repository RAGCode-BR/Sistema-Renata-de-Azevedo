import { Select } from '../../components/Select.tsx';
import { useState } from 'react';
import type { Patient, PatientStatus, Professional } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal } from '../../components/Modal.tsx';
import { age, patientStatusLabel, validCpf } from '../../format.ts';
import { text, useLoad } from '../../hooks.ts';

interface PatientFormProps {
  // Sem `patient`: cadastro novo.
  patient?: Patient;
  professionals: Professional[];
  onClose: () => void;
  onSaved: (id: string, message: string) => void;
}

// Cadastro administrativo em grupos curtos. O bloco do responsável legal só aparece quando marcado
// (já vem marcado para menores de idade ou quando o cadastro tem responsável).
export function PatientForm({ patient, professionals, onClose, onSaved }: PatientFormProps) {
  const [birthDate, setBirthDate] = useState(patient?.birth_date?.slice(0, 10) ?? '');
  const minor = (age(birthDate) ?? 99) < 18;
  const [hasGuardian, setHasGuardian] = useState(Boolean(patient?.guardian_name));
  const showGuardian = hasGuardian || minor;
  // Profissionais ativas, mais as inativas que ainda estão vinculadas a este paciente.
  const options = professionals.filter((item) => item.active || patient?.professional_ids.includes(item.id));
  // Origem (Instagram, indicação…): alimenta os indicadores do Comercial.
  const sources = useLoad(() => api.leadSources().catch(() => []), []).data ?? [];

  return (
    <FormModal title={patient ? `Editar ${patient.name}` : 'Novo paciente'} submitLabel={patient ? 'Salvar' : 'Cadastrar paciente'}
      onClose={onClose} onSubmit={async (data) => {
        const professionalIds = data.getAll('professionalIds').map(String);
        if (!professionalIds.length) throw new Error('Selecione ao menos uma profissional responsável.');
        const cpf = text(data, 'cpf');
        if (cpf && !validCpf(cpf)) throw new Error('CPF inválido.');
        const guardian = (field: string) => (showGuardian ? text(data, field) : '');
        const id = await api.savePatient(patient?.id ?? null, {
          name: text(data, 'name'),
          social_name: text(data, 'social_name'),
          birth_date: birthDate,
          cpf,
          phone: text(data, 'phone'),
          email: text(data, 'email'),
          address: text(data, 'address'),
          guardian_name: guardian('guardian_name'),
          guardian_relationship: guardian('guardian_relationship'),
          guardian_phone: guardian('guardian_phone'),
          guardian_email: guardian('guardian_email'),
          admin_notes: text(data, 'admin_notes'),
          status: (text(data, 'status') || 'active') as PatientStatus,
          professionalIds
        });
        const optIn = data.get('whatsapp') === 'on';
        if (optIn && text(data, 'phone').replace(/\D/g, '').length < 10) throw new Error('Para autorizar o WhatsApp, informe o celular com DDD.');
        const source = text(data, 'source') || null;
        if (sources.length && source !== (patient?.source_id ?? null)) await api.setPatientOrigin(id, source, patient?.campaign_id ?? null);
        if (optIn !== Boolean(patient?.whatsapp_opt_in)) await api.setPatientWhatsapp(id, optIn);
        onSaved(id, patient ? 'Cadastro atualizado.' : 'Paciente cadastrado.');
      }}>
      <fieldset className="full form-section">
        <legend>Dados pessoais</legend>
        <div className="form-grid">
          <Field label="Nome" full><input className="input" name="name" required maxLength={200} defaultValue={patient?.name} /></Field>
          <Field label="Nome social (opcional)"><input className="input" name="social_name" maxLength={200} defaultValue={patient?.social_name ?? ''} /></Field>
          <Field label="Nascimento">
            <input className="input" name="birthDate" type="date" value={birthDate} onChange={(event) => setBirthDate(event.target.value)} />
          </Field>
          <Field label="CPF (opcional)"><input className="input" name="cpf" inputMode="numeric" maxLength={14} placeholder="000.000.000-00" defaultValue={patient?.cpf ?? ''} /></Field>
        </div>
      </fieldset>

      <fieldset className="full form-section">
        <legend>Contato</legend>
        <div className="form-grid">
          <Field label="Telefone"><input className="input" name="phone" type="tel" autoComplete="off" defaultValue={patient?.phone ?? ''} /></Field>
          <label className="check full">
            <input type="checkbox" name="whatsapp" defaultChecked={patient?.whatsapp_opt_in ?? false} />
            <span>Aceita receber confirmações e lembretes de sessão pelo WhatsApp<span className="sub">Autorização do paciente (LGPD). Nenhuma informação clínica é enviada.</span></span>
          </label>
          <Field label="E-mail"><input className="input" name="email" type="email" autoComplete="off" defaultValue={patient?.email ?? ''} /></Field>
          <Field label="Endereço (opcional)" full><input className="input" name="address" maxLength={300} defaultValue={patient?.address ?? ''} /></Field>
        </div>
      </fieldset>

      <fieldset className="full form-section">
        <legend>Responsável legal</legend>
        {minor ? <p className="muted small">Paciente menor de idade: informe o responsável legal.</p> : (
          <label className="check"><input type="checkbox" checked={hasGuardian} onChange={(event) => setHasGuardian(event.target.checked)} />Tem responsável legal</label>
        )}
        {showGuardian && (
          <div className="form-grid">
            <Field label="Nome do responsável"><input className="input" name="guardian_name" required={minor} defaultValue={patient?.guardian_name ?? ''} /></Field>
            <Field label="Parentesco"><input className="input" name="guardian_relationship" placeholder="Ex.: mãe, pai, tutor" defaultValue={patient?.guardian_relationship ?? ''} /></Field>
            <Field label="Telefone do responsável"><input className="input" name="guardian_phone" type="tel" defaultValue={patient?.guardian_phone ?? ''} /></Field>
            <Field label="E-mail do responsável"><input className="input" name="guardian_email" type="email" defaultValue={patient?.guardian_email ?? ''} /></Field>
          </div>
        )}
      </fieldset>

      <fieldset className="full form-section">
        <legend>Acompanhamento</legend>
        <div className="form-grid">
          <Field label="Situação">
            <Select className="input" name="status" defaultValue={patient?.status ?? 'active'}>
              {Object.entries(patientStatusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
          {sources.length > 0 && (
            <Field label="Como conheceu a clínica">
              <Select className="input" name="source" defaultValue={patient?.source_id ?? ''} key={sources.length}>
                <option value="">Não informado</option>
                {sources.filter((item) => item.active || item.id === patient?.source_id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <div className="checks" role="group" aria-label="Profissionais responsáveis">
          <span className="muted small full-row">Profissionais responsáveis</span>
          {options.length ? options.map((item) => (
            <label key={item.id} className="check">
              <input type="checkbox" name="professionalIds" value={item.id} defaultChecked={patient?.professional_ids.includes(item.id)} />
              {item.name}{!item.active && ' (inativa)'}
            </label>
          )) : <p className="muted small">Cadastre uma profissional antes.</p>}
        </div>
        {patient && (
          <p className="muted small">Ao tirar uma profissional, ela deixa de ver este paciente; o que ela registrou no prontuário continua guardado.</p>
        )}
      </fieldset>

      <Field label="Observações administrativas (não registre informações clínicas aqui)" full>
        <textarea className="input" name="admin_notes" rows={3} maxLength={2000} defaultValue={patient?.admin_notes ?? ''} />
      </Field>
    </FormModal>
  );
}
