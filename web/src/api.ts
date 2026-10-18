import { FunctionsHttpError } from '@supabase/supabase-js';
import type { PostgrestError } from '@supabase/supabase-js';
import type {
  Appointment,
  AppointmentEvent,
  AppointmentStatus,
  CaseFormulation,
  Charge,
  ClinicSettings,
  ClinicalExport,
  ClinicalNoteInput,
  ClinicalRecord,
  DocumentCategory,
  Expense,
  FinanceMonth,
  FormulationSection,
  FormulationTemplate,
  GoogleCalendar,
  NamedItem,
  NewAppointment,
  NewPayment,
  NewProfessional,
  NewScheduleBlock,
  NewUser,
  NoteStatusRow,
  Patient,
  PatientDocument,
  PatientInput,
  Payment,
  PayoutRow,
  PendingNote,
  Professional,
  Receivables,
  Role,
  ScheduleBlock,
  SessionPrice,
  SessionUser,
  UserAccessUpdate,
  UserAccount
} from '../../shared/types.ts';
import { supabase } from './supabase.ts';

// Mensagens para os erros do banco. As regras (RLS, conflito de horário, vínculos) ficam em
// supabase/migrations; aqui só traduzimos o resultado para quem está usando.
function databaseError(error: PostgrestError): Error {
  switch (error.code) {
    case '23505': return new Error('Este cadastro já existe.');
    case '23P01': return new Error('Já existe sessão nesse horário para esta profissional.');
    case 'P0001': return new Error(error.message);
    case '42501': return new Error('Você não tem acesso a esta área.');
    case '23503': case '23514': case '22P02': case '22007': case '22008': return new Error('Dados inválidos para este cadastro.');
    default:
      console.error(error);
      return new Error('Não foi possível concluir a operação.');
  }
}

// O tipo de cada resposta é declarado aqui, pois sem tipos gerados do banco o supabase-js não o conhece.
async function run<T>(query: PromiseLike<{ data: unknown; error: PostgrestError | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw databaseError(error);
  return data as T;
}

// Chama uma Edge Function e devolve a mensagem de erro dela, quando houver.
async function invoke<T = unknown>(name: string, body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null;
    throw new Error(detail?.error || fallback);
  }
  return data as T;
}

async function count(query: PromiseLike<{ count: number | null; error: PostgrestError | null }>): Promise<number> {
  const { count: total, error } = await query;
  if (error) throw databaseError(error);
  return total ?? 0;
}

const DOCUMENTS_BUCKET = 'patient-documents';

let onSessionEnded = () => {};
let leaving = false;

// Chamado quando a sessão termina sem a pessoa ter clicado em Sair (ex.: expirou em outra aba).
export function setUnauthorizedHandler(handler: () => void): void {
  onSessionEnded = handler;
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && !leaving) onSessionEnded();
});

const PATIENT_COLUMNS = 'id, name, social_name, phone, email, birth_date, cpf, address, admin_notes, guardian_name, '
  + 'guardian_relationship, guardian_phone, guardian_email, status, created_at, patient_professionals(professional_id)';
type PatientRow = Omit<Patient, 'professional_ids'> & { patient_professionals: { professional_id: string }[] };
const toPatient = ({ patient_professionals, ...row }: PatientRow): Patient =>
  ({ ...row, professional_ids: patient_professionals.map((link) => link.professional_id) });

const APPOINTMENT_COLUMNS = 'id, patient_id, professional_id, starts_at, ends_at, status, modality, session_type, series_id, '
  + 'rescheduled_from, cancellation_reason, patients(name), professionals(name)';
type AppointmentRow = Omit<Appointment, 'patient_name' | 'professional_name'> & {
  patients: { name: string } | null;
  professionals: { name: string } | null;
};
const toAppointment = ({ patients, professionals, ...row }: AppointmentRow): Appointment =>
  ({ ...row, patient_name: patients?.name ?? '—', professional_name: professionals?.name ?? '—' });

export const api = {
  // Quem está conectado, com perfis e permissões; null sem sessão, com conta inativa ou sem perfil da equipe.
  session: async (): Promise<SessionUser | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const [profile, access] = await Promise.all([
      run<{ id: string; name: string; email: string; professional_id: string | null; active: boolean } | null>(
        supabase.from('profiles').select('id, name, email, professional_id, active').eq('id', session.user.id).maybeSingle()),
      run<Pick<SessionUser, 'roles' | 'permissions'>>(supabase.rpc('my_access'))
    ]);
    const staff = access.roles.some((role) => role !== 'patient');
    if (!profile?.active || !staff) return null;
    const { active: _active, ...user } = profile;
    return { ...user, ...access };
  },
  login: async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'E-mail ou senha inválidos.');
  },
  logout: async () => {
    leaving = true;
    try { await supabase.auth.signOut(); } finally { leaving = false; }
  },
  // A senha atual é conferida entrando de novo antes da troca.
  changePassword: async (currentPassword: string, newPassword: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) throw new Error('Entre na sua conta para continuar.');
    const check = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
    if (check.error) throw new Error('Senha atual incorreta.');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.code === 'same_password' ? 'A nova senha precisa ser diferente da atual.' : 'Senha fraca. Escolha uma senha mais longa.');
  },

  professionals: () => run<Professional[]>(supabase.from('professionals').select('id, name, email, specialty, active').order('name')),
  createProfessional: (input: NewProfessional) => run<unknown>(supabase.from('professionals')
    .insert({ name: input.name, email: input.email || null, specialty: input.specialty || null }).select('id').single()),
  updateProfessional: (id: string, input: NewProfessional & { active: boolean }) => run<unknown>(supabase.from('professionals')
    .update({ name: input.name, email: input.email || null, specialty: input.specialty || null, active: input.active })
    .eq('id', id).select('id').single()),

  users: async (): Promise<UserAccount[]> => {
    const rows = await run<(Omit<UserAccount, 'roles'> & { user_roles: { role: Role }[] })[]>(supabase.from('profiles')
      .select('id, name, email, professional_id, active, user_roles(role)').order('name'));
    return rows.map(({ user_roles, ...row }) => ({ ...row, roles: user_roles.map((item) => item.role) }));
  },
  // Criar e excluir contas exige a chave de serviço: ficam nas Edge Functions (supabase/functions).
  createUser: async (input: NewUser) => {
    await invoke('admin-create-user', { ...input }, 'Não foi possível criar a conta.');
  },
  // Perfis, profissional vinculada e situação: função do banco que aplica as regras (set_user_access).
  updateUserAccess: (input: UserAccessUpdate) => run<unknown>(supabase.rpc('set_user_access', {
    p_user_id: input.userId,
    p_roles: input.roles,
    p_professional_id: input.professionalId,
    p_active: input.active
  })),
  deleteUser: async (userId: string) => {
    await invoke('admin-delete-user', { userId }, 'Não foi possível excluir a conta.');
  },

  // Quantidades para o painel. Cada um conta só o que pode ver (RLS): a profissional, a própria carteira.
  activePatientsCount: () => count(supabase.from('patients').select('id', { count: 'exact', head: true }).eq('status', 'active')),
  activeProfessionalsCount: () => count(supabase.from('professionals').select('id', { count: 'exact', head: true }).eq('active', true)),

  patients: async () => (await run<PatientRow[]>(supabase.from('patients').select(PATIENT_COLUMNS).order('name'))).map(toPatient),
  patient: async (id: string) => {
    const row = await run<PatientRow | null>(supabase.from('patients').select(PATIENT_COLUMNS).eq('id', id).maybeSingle());
    return row ? toPatient(row) : null;
  },
  // Cria (id nulo) ou edita o cadastro e os vínculos com profissionais numa só transação.
  savePatient: (id: string | null, { professionalIds, ...data }: PatientInput) =>
    run<string>(supabase.rpc('save_patient', { p_id: id, p_data: data, p_professional_ids: professionalIds })),
  // Todas as sessões do paciente que quem está conectado pode ver (a profissional, só as suas).
  patientAppointments: async (patientId: string) => (await run<AppointmentRow[]>(supabase.from('appointments')
    .select(APPOINTMENT_COLUMNS).eq('patient_id', patientId).order('starts_at', { ascending: false }))).map(toAppointment),

  // Documentos administrativos: arquivo no bucket privado, lido só por link temporário.
  patientDocuments: (patientId: string) => run<PatientDocument[]>(supabase.from('patient_documents')
    .select('id, patient_id, title, category, storage_path, size_bytes, mime_type, created_at')
    .eq('patient_id', patientId).order('created_at', { ascending: false })),
  uploadPatientDocument: async (patientId: string, file: File, title: string, category: DocumentCategory) => {
    const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
    const path = `patients/${patientId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(/size|exceed/i.test(error.message) ? 'Arquivo maior que 10 MB.'
      : /mime|type/i.test(error.message) ? 'Tipo de arquivo não aceito. Use PDF, imagem ou Word.' : 'Não foi possível enviar o arquivo.');
    try {
      await run(supabase.from('patient_documents').insert({
        patient_id: patientId, title, category, storage_path: path, size_bytes: file.size, mime_type: file.type || null
      }).select('id').single());
    } catch (failure) {
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
      throw failure;
    }
  },
  // Link válido por 60 segundos, só para quem pode ver o paciente (política do Storage).
  documentUrl: async (document: PatientDocument) => {
    const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(document.storage_path, 60);
    if (error || !data) throw new Error('Não foi possível abrir o documento.');
    return data.signedUrl;
  },
  deletePatientDocument: async (document: PatientDocument) => {
    await run(supabase.from('patient_documents').delete().eq('id', document.id).select('id').single());
    await supabase.storage.from(DOCUMENTS_BUCKET).remove([document.storage_path]);
  },

  appointments: async (from: Date, to: Date) => (await run<AppointmentRow[]>(supabase.from('appointments')
    .select(APPOINTMENT_COLUMNS).gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
    .order('starts_at'))).map(toAppointment),
  // Sessão única: inserção direta (RLS + conflitos no banco). Série: função que cria todas ou nenhuma.
  createAppointment: (input: NewAppointment) => input.recurrence
    ? run<unknown>(supabase.rpc('create_appointment_series', {
      p_patient_id: input.patientId,
      p_professional_id: input.professionalId,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_modality: input.modality,
      p_session_type: input.sessionType,
      p_frequency: input.recurrence.frequency,
      p_count: input.recurrence.count
    }))
    : run<unknown>(supabase.from('appointments').insert({
      patient_id: input.patientId,
      professional_id: input.professionalId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      modality: input.modality,
      session_type: input.sessionType
    }).select('id').single()),
  // Mudanças de sessão passam pelas funções do banco, que aplicam as regras e gravam o histórico.
  setAppointmentStatus: (id: string, status: AppointmentStatus) =>
    run<unknown>(supabase.rpc('set_appointment_status', { p_id: id, p_status: status })),
  cancelAppointment: (id: string, by: 'patient' | 'clinic', reason: string, following: boolean) =>
    run<number>(supabase.rpc('cancel_appointment', { p_id: id, p_by: by, p_reason: reason, p_following: following })),
  rescheduleAppointment: (id: string, startsAt: string, endsAt: string) =>
    run<string>(supabase.rpc('reschedule_appointment', { p_id: id, p_starts_at: startsAt, p_ends_at: endsAt })),
  appointmentEvents: (id: string) => run<AppointmentEvent[]>(supabase.from('appointment_events')
    .select('id, action, from_status, to_status, reason, created_at').eq('appointment_id', id).order('created_at')),
  // Sessões que já terminaram e continuam "agendadas/confirmadas": presença ainda não registrada.
  unrecordedAttendance: async (since: Date) => (await run<AppointmentRow[]>(supabase.from('appointments')
    .select(APPOINTMENT_COLUMNS).gte('starts_at', since.toISOString()).lt('ends_at', new Date().toISOString())
    .in('status', ['scheduled', 'awaiting_confirmation', 'confirmed']).order('starts_at'))).map(toAppointment),

  scheduleBlocks: (from: Date, to: Date) => run<ScheduleBlock[]>(supabase.rpc('list_schedule_blocks', {
    p_from: from.toISOString(), p_to: to.toISOString()
  })),
  createScheduleBlock: (input: NewScheduleBlock) => run<string>(supabase.rpc('create_schedule_block', {
    p_professional_id: input.professionalId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_reason: input.reason,
    p_reason_private: input.reasonPrivate
  })),
  deleteScheduleBlock: (id: string) => run<unknown>(supabase.rpc('delete_schedule_block', { p_id: id })),

  // Prontuário: tudo passa por funções do banco que conferem a autoria e registram o acesso.
  clinicalRecord: (patientId: string) => run<ClinicalRecord>(supabase.rpc('clinical_record', { p_patient_id: patientId })),
  noteRevisions: (noteId: string) => run<{ body: string; saved_at: string }[]>(supabase.rpc('clinical_note_revisions', { p_note_id: noteId })),
  saveClinicalNote: (input: ClinicalNoteInput) => run<string>(supabase.rpc('save_clinical_note', {
    p_id: input.id, p_patient_id: input.patientId, p_appointment_id: input.appointmentId, p_kind: input.kind, p_body: input.body
  })),
  finalizeClinicalNote: (id: string) => run<unknown>(supabase.rpc('finalize_clinical_note', { p_id: id })),
  rectifyClinicalNote: (id: string, body: string, reason: string) =>
    run<string>(supabase.rpc('rectify_clinical_note', { p_id: id, p_body: body, p_reason: reason })),
  deleteClinicalNote: (id: string) => run<unknown>(supabase.rpc('delete_clinical_note', { p_id: id })),
  exportClinicalRecord: (patientId: string) => run<ClinicalExport>(supabase.rpc('export_clinical_record', { p_patient_id: patientId })),

  saveFormulation: (patientId: string, templateName: string, sections: FormulationSection[], content: Record<string, string>) =>
    run<string>(supabase.rpc('save_case_formulation', {
      p_patient_id: patientId, p_template_name: templateName, p_sections: sections, p_content: content
    })),
  // Modelos não têm dado de paciente: leitura e escrita direta, com RLS (da clínica + os próprios).
  formulationTemplates: () => run<FormulationTemplate[]>(supabase.from('case_formulation_templates')
    .select('id, professional_id, name, sections').order('professional_id', { nullsFirst: true }).order('name')),
  saveFormulationTemplate: (template: { id: string | null; professionalId: string; name: string; sections: FormulationSection[] }) =>
    template.id
      ? run<unknown>(supabase.from('case_formulation_templates').update({ name: template.name, sections: template.sections, updated_at: new Date().toISOString() })
        .eq('id', template.id).select('id').single())
      : run<unknown>(supabase.from('case_formulation_templates').insert({ professional_id: template.professionalId, name: template.name, sections: template.sections })
        .select('id').single()),
  deleteFormulationTemplate: (id: string) => run<unknown>(supabase.from('case_formulation_templates').delete().eq('id', id).select('id').single()),

  // Documento clínico: envio direto à pasta da profissional; abertura só pela Edge Function (que registra).
  uploadClinicalDocument: async (patientId: string, professionalId: string, file: File, title: string) => {
    const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
    const path = `patients/${patientId}/${professionalId}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from('clinical-documents').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error(/size|exceed/i.test(error.message) ? 'Arquivo maior que 10 MB.'
      : /mime|type/i.test(error.message) ? 'Tipo de arquivo não aceito. Use PDF, imagem ou Word.' : 'Não foi possível enviar o arquivo.');
    await run(supabase.rpc('register_clinical_document', {
      p_patient_id: patientId, p_title: title, p_storage_path: path, p_size_bytes: file.size, p_mime_type: file.type || null
    }));
  },
  clinicalDocumentUrl: async (id: string) =>
    (await invoke<{ url: string }>('clinical-document-url', { documentId: id }, 'Não foi possível abrir o documento.')).url,

  noteStatus: (from: Date, to: Date) => run<NoteStatusRow[]>(supabase.rpc('clinical_note_status', {
    p_from: from.toISOString(), p_to: to.toISOString()
  })),
  settings: () => run<ClinicSettings>(supabase.from('clinic_settings')
    .select('note_deadline_hours, missed_charge_percent, late_cancel_hours, late_cancel_charge_percent').single()),
  // Financeiro. Cobranças e pagamentos só por funções do banco (somas, situação e regras ficam lá).
  charges: (from: string | null, to: string | null, options: { patientId?: string; open?: boolean } = {}) =>
    run<Charge[]>(supabase.rpc('charge_list', { p_from: from, p_to: to, p_patient_id: options.patientId ?? null, p_open: options.open ?? false })),
  payments: (from: string | null, to: string | null, patientId?: string) =>
    run<Payment[]>(supabase.rpc('payment_list', { p_from: from, p_to: to, p_patient_id: patientId ?? null })),
  patientCredit: (patientId: string) => run<number>(supabase.rpc('patient_credit', { p_patient_id: patientId })),
  registerPayment: (input: NewPayment) => run<string>(supabase.rpc('register_payment', {
    p_patient_id: input.patientId, p_amount: input.amount, p_method: input.method, p_received_at: input.receivedAt,
    p_charge_ids: input.chargeIds, p_notes: input.notes
  })),
  reversePayment: (id: string, reason: string) => run<unknown>(supabase.rpc('reverse_payment', { p_id: id, p_reason: reason })),
  applyCredit: (chargeId: string) => run<number>(supabase.rpc('apply_patient_credit', { p_charge_id: chargeId })),
  createCharge: (input: { patientId: string; professionalId: string | null; description: string; amount: number; competenceDate: string; dueDate: string }) =>
    run<string>(supabase.rpc('create_charge', {
      p_patient_id: input.patientId, p_professional_id: input.professionalId, p_description: input.description,
      p_amount: input.amount, p_competence_date: input.competenceDate, p_due_date: input.dueDate
    })),
  updateCharge: (id: string, input: { amount: number; discount: number; dueDate: string; description: string }) =>
    run<unknown>(supabase.rpc('update_charge', {
      p_id: id, p_amount: input.amount, p_discount: input.discount, p_due_date: input.dueDate, p_description: input.description
    })),
  cancelCharge: (id: string, reason: string) => run<unknown>(supabase.rpc('cancel_charge', { p_id: id, p_reason: reason })),
  receivables: async () => (await run<Receivables[]>(supabase.rpc('receivables_now')))[0] ?? { open_amount: 0, overdue_amount: 0, overdue_count: 0 },
  patientPrice: (patientId: string) => run<number | null>(supabase.rpc('patient_price', { p_patient_id: patientId })),
  setPatientPrice: (patientId: string, amount: number | null) => run<unknown>(supabase.rpc('set_patient_price', { p_patient_id: patientId, p_amount: amount })),

  sessionPrices: () => run<SessionPrice[]>(supabase.from('session_prices').select('id, professional_id, session_type, amount')),
  saveSessionPrice: (price: { id: string | null; professionalId: string | null; sessionType: string | null; amount: number }) => price.id
    ? run<unknown>(supabase.from('session_prices').update({ amount: price.amount, updated_at: new Date().toISOString() }).eq('id', price.id).select('id').single())
    : run<unknown>(supabase.from('session_prices').insert({ professional_id: price.professionalId, session_type: price.sessionType, amount: price.amount }).select('id').single()),
  deleteSessionPrice: (id: string) => run<unknown>(supabase.from('session_prices').delete().eq('id', id).select('id').single()),

  expenses: (from: string, to: string) => run<Expense[]>(supabase.from('expenses')
    .select('id, description, supplier, category_id, cost_center_id, amount, competence_date, due_date, paid_at, method, notes')
    .gte('due_date', from).lte('due_date', to).order('due_date')),
  saveExpense: (id: string | null, input: Omit<Expense, 'id'>) => id
    ? run<unknown>(supabase.from('expenses').update({ ...input, updated_at: new Date().toISOString() }).eq('id', id).select('id').single())
    : run<unknown>(supabase.from('expenses').insert(input).select('id').single()),
  deleteExpense: (id: string) => run<unknown>(supabase.from('expenses').delete().eq('id', id).select('id').single()),
  costCenters: () => run<NamedItem[]>(supabase.from('cost_centers').select('id, name, active').order('name')),
  financeCategories: () => run<NamedItem[]>(supabase.from('finance_categories').select('id, name, active').order('name')),
  saveNamedItem: (table: 'cost_centers' | 'finance_categories', item: { id: string | null; name: string; active: boolean }) => item.id
    ? run<unknown>(supabase.from(table).update({ name: item.name, active: item.active }).eq('id', item.id).select('id').single())
    : run<unknown>(supabase.from(table).insert({ name: item.name }).select('id').single()),

  payoutStatement: (month: string) => run<PayoutRow[]>(supabase.rpc('payout_statement', { p_month: month })),
  setPayoutPercent: (professionalId: string, percent: number | null) =>
    run<unknown>(supabase.rpc('set_payout_percent', { p_professional_id: professionalId, p_percent: percent })),
  closePayout: (professionalId: string, month: string, paidAt: string) =>
    run<string>(supabase.rpc('close_payout', { p_professional_id: professionalId, p_month: month, p_paid_at: paidAt })),
  financeSummary: (year: number) => run<FinanceMonth[]>(supabase.rpc('finance_summary', { p_year: year })),
  expenseBreakdown: (year: number) => run<{ dimension: 'cost_center' | 'category'; name: string; amount: number }[]>(
    supabase.rpc('expense_breakdown', { p_year: year })),
  updateSettings: (input: Partial<ClinicSettings>) => run<unknown>(supabase.from('clinic_settings')
    .update({ ...input, updated_at: new Date().toISOString() }).eq('id', true).select('id').single()),
  // Sessões realizadas sem evolução: todas para quem vê a agenda geral, só as próprias para a profissional.
  pendingNotes: () => run<PendingNote[]>(supabase.rpc('pending_clinical_notes')),

  googleCalendars: () => run<GoogleCalendar[]>(supabase.rpc('list_google_calendars'))
};
