// Acesso aos dados (Supabase), compartilhado pela web e pelo aplicativo. Cada um cria o próprio cliente
// (sessão no navegador ou no cofre do celular) e chama createApi(cliente).
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import type {
  AgingRow,
  AiRun,
  AiRunSummary,
  AiStatus,
  AiUsageRow,
  AppNotification,
  CampaignReportRow,
  DreRow,
  ExpenseReportRow,
  PatientReport,
  PaymentMethodRow,
  PerformanceReport,
  PayoutReportRow,
  RevenueRow,
  SessionReportRow,
  TaskReportRow,
  YearRow,
  Campaign,
  CampaignInput,
  CrmMonth,
  CrmSummary,
  ImportRow,
  Lead,
  LeadAssessment,
  PatientProfessionalEvent,
  CrmProfessionalFlow,
  LeadActivity,
  LeadDuplicate,
  LeadInput,
  LeadStage,
  MfaEnrollment,
  MfaState,
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
  FinanceForecastRow,
  FormulationSection,
  FormulationTemplate,
  GoogleCalendar,
  GoogleSyncStatus,
  WhatsappConversation,
  WhatsappMessage,
  WhatsappState,
  NamedItem,
  NewAppointment,
  NewPayment,
  NewProfessional,
  ProfessionalDocument,
  NewScheduleBlock,
  NewUser,
  NoteStatusRow,
  Patient,
  PatientActivity,
  PatientFormAssignment,
  PatientFormKind,
  PatientFormQuestion,
  PatientFormResult,
  PatientFormTemplate,
  PatientWhatsappTaskSource,
  PatientDocument,
  PatientInput,
  Payment,
  PayoutRow,
  PendingNote,
  PortalAccess,
  PortalAppointment,
  PortalCharge,
  PortalDocument,
  PortalMe,
  PortalPayment,
  PortalRelationship,
  PortalRequest,
  PortalSharedDocument,
  PortalState,
  Professional,
  Receivables,
  Role,
  ScheduleBlock,
  SessionPrice,
  SessionUser,
  Task,
  TaskCounts,
  TaskEvent,
  TaskFrequency,
  TaskInput,
  TaskRecurrence,
  TaskScope,
  TaskStatus,
  UserAccessUpdate,
  UserAccount
} from './types.ts';

// Mensagens para os erros do banco. As regras (RLS, conflito de horário, vínculos) ficam em
// supabase/migrations; aqui só traduzimos o resultado para quem está usando.
function databaseError(error: PostgrestError): Error {
  switch (error.code) {
    case '23505': return new Error('Este cadastro já existe.');
    case '23P01': return new Error('Já existe sessão nesse horário para esta profissional.');
    case 'P0001': return new Error(error.message);
    // Recusas escritas para quem usa (ex.: portal desligado, termos não aceitos) passam como estão.
    case '42501': return new Error(/^(O portal|Aceite os termos)/.test(error.message) ? error.message : 'Você não tem acesso a esta área.');
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

async function count(query: PromiseLike<{ count: number | null; error: PostgrestError | null }>): Promise<number> {
  const { count: total, error } = await query;
  if (error) throw databaseError(error);
  return total ?? 0;
}

const DOCUMENTS_BUCKET = 'patient-documents';
const PORTAL_BUCKET = 'portal-documents';

const PATIENT_COLUMNS = 'id, name, social_name, phone, email, birth_date, cpf, address, admin_notes, guardian_name, '
  + 'guardian_relationship, guardian_phone, guardian_email, status, exit_reason, status_changed_at, created_at, source_id, campaign_id, whatsapp_opt_in, '
  + 'email_opt_in, sms_opt_in, sex, rg, occupation, marital_status, tags, additional_contacts, emergency_contacts, '
  + 'identification_documents, address_country, address_postal_code, address_state, address_city, address_district, '
  + 'address_street, address_number, address_complement, photo_path, patient_professionals(professional_id)';
type PatientRow = Omit<Patient, 'professional_ids'> & { patient_professionals: { professional_id: string }[] };
const toPatient = ({ patient_professionals, ...row }: PatientRow): Patient =>
  ({ ...row, professional_ids: patient_professionals.map((link) => link.professional_id) });

const APPOINTMENT_COLUMNS = 'id, patient_id, professional_id, starts_at, ends_at, status, modality, session_type, series_id, '
  + 'rescheduled_from, cancellation_reason, meeting_url, patients(name), professionals(name)';
type AppointmentRow = Omit<Appointment, 'patient_name' | 'professional_name'> & {
  patients: { name: string } | null;
  professionals: { name: string } | null;
};
const toAppointment = ({ patients, professionals, ...row }: AppointmentRow): Appointment =>
  ({ ...row, patient_name: patients?.name ?? '—', professional_name: professionals?.name ?? '—' });

export type Api = ReturnType<typeof createApi>;

export function createApi(supabase: SupabaseClient) {
  let onSessionEnded = () => {};
  let leaving = false;

  // Sessão encerrada sem a pessoa ter pedido para sair (ex.: expirou ou saiu em outra aba).
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !leaving) onSessionEnded();
  });

  // Chama uma Edge Function e devolve a mensagem de erro dela, quando houver.
  async function invoke<T = unknown>(name: string, body: Record<string, unknown>, fallback: string): Promise<T> {
    const { data, error } = await supabase.functions.invoke<T>(name, { body });
    if (error) {
      // Erro HTTP da função: a resposta vem em `context` (sem depender da classe, que muda entre cópias do pacote).
      const context = (error as { context?: unknown }).context;
      const detail = context instanceof Response ? await context.json().catch(() => null) : null;
      throw new Error(detail?.error || fallback);
    }
    return data as T;
  }

  const api = {
    setUnauthorizedHandler: (handler: () => void) => { onSessionEnded = handler; },
    // Quem está conectado, com perfis e permissões; null sem sessão, com conta inativa ou sem perfil da equipe.
    session: async (): Promise<SessionUser | null> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      const [profile, access] = await Promise.all([
        run<{ id: string; name: string; email: string; professional_id: string | null; active: boolean } | null>(
          supabase.from('profiles').select('id, name, email, professional_id, active').eq('id', session.user.id).maybeSingle()),
        run<Pick<SessionUser, 'roles' | 'permissions' | 'mfa'>>(supabase.rpc('my_access'))
      ]);
      const staff = access.roles.some((role) => role !== 'patient');
      if (!profile?.active || !staff) return null;
      const { active: _active, ...user } = profile;
      // Quem cadastrou o app autenticador digita o código ao entrar, mesmo quando a clínica não exige.
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      const mfa: MfaState = level?.nextLevel === 'aal2' && level.currentLevel !== 'aal2' ? 'verify' : access.mfa ?? 'ok';
      return { ...user, ...access, mfa };
    },
    // Verificação em duas etapas (TOTP do Supabase Auth).
    mfaFactor: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw new Error('Não foi possível consultar a verificação em duas etapas.');
      return data.totp.find((factor) => factor.status === 'verified') ?? null;
    },
    mfaEnroll: async (): Promise<MfaEnrollment> => {
      // Tentativas anteriores não concluídas impedem um cadastro novo: saem antes.
      const { data: current } = await supabase.auth.mfa.listFactors();
      for (const factor of current?.all ?? []) {
        if (factor.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `App autenticador ${new Date().toISOString()}` });
      if (error || !data) throw new Error('Não foi possível iniciar o cadastro do app autenticador.');
      return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
    },
    // Confere o código de 6 dígitos; a sessão passa a valer como verificada.
    mfaVerify: async (code: string, factorId?: string) => {
      const id = factorId ?? (await supabase.auth.mfa.listFactors()).data?.totp.find((factor) => factor.status === 'verified')?.id;
      if (!id) throw new Error('Nenhum app autenticador cadastrado.');
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: code.replace(/\D/g, '') });
      if (error) throw new Error(error.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Código inválido. Confira o horário do celular e tente o código atual.');
    },
    mfaUnenroll: async (factorId: string) => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw new Error('Para desativar, entre de novo usando o código do app autenticador.');
    },
    setMfaRequired: (required: boolean) => run<unknown>(supabase.rpc('set_mfa_required', { p_required: required })),
    // Conta só de paciente: vai para o portal, não para o sistema da equipe.
    isPatientAccount: async () => {
      const access = await run<{ roles: Role[] }>(supabase.rpc('my_access'));
      return access.roles.length > 0 && access.roles.every((role) => role === 'patient');
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

    professionals: () => run<Professional[]>(supabase.from('professionals').select('id, name, email, specialty, active, tags, color, photo_path, commission_sales, commission_sessions, uses_clinic_hours').order('name')),
    createProfessional: (input: NewProfessional) => run<{ id: string }>(supabase.from('professionals')
      .insert({ name: input.name, email: input.email || null, specialty: input.specialty || null,
        tags: input.tags, color: input.color, commission_sales: input.commission_sales,
        commission_sessions: input.commission_sessions, uses_clinic_hours: input.uses_clinic_hours }).select('id').single()),
    updateProfessional: (id: string, input: NewProfessional & { active: boolean }) => run<unknown>(supabase.from('professionals')
      .update({ name: input.name, email: input.email || null, specialty: input.specialty || null,
        tags: input.tags, color: input.color, active: input.active,
        commission_sales: input.commission_sales, commission_sessions: input.commission_sessions,
        uses_clinic_hours: input.uses_clinic_hours })
      .eq('id', id).select('id').single()),
    professionalPhotoUrl: async (path: string) => {
      const { data, error } = await supabase.storage.from('professional-files').createSignedUrl(path, 60);
      if (error || !data) throw new Error('Não foi possível abrir a foto.');
      return data.signedUrl;
    },
    uploadProfessionalPhoto: async (professionalId: string, file: File) => {
      if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024)
        throw new Error('A foto deve ser JPG ou PNG e ter até 2 MB.');
      const path = `professionals/${professionalId}/photo/${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
      const { error } = await supabase.storage.from('professional-files').upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(`Não foi possível enviar a foto: ${error.message}`);
      try { await run(supabase.from('professionals').update({ photo_path: path }).eq('id', professionalId).select('id').single()); }
      catch (failure) { await supabase.storage.from('professional-files').remove([path]); throw failure; }
      return path;
    },
    professionalDocuments: (professionalId: string) => run<ProfessionalDocument[]>(supabase.from('professional_documents')
      .select('id, professional_id, title, storage_path, size_bytes, mime_type, created_at')
      .eq('professional_id', professionalId).order('created_at', { ascending: false })),
    uploadProfessionalDocument: async (professionalId: string, file: File) => {
      const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
      const path = `professionals/${professionalId}/files/${crypto.randomUUID()}.${extension}`;
      const mimeByExtension: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg',
        png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
        txt: 'text/plain', doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ogg: 'audio/ogg', mp4: 'video/mp4', mov: 'video/quicktime' };
      const mimeType = mimeByExtension[extension] ?? file.type.split(';')[0] ?? 'application/octet-stream';
      const { error } = await supabase.storage.from('professional-files').upload(path, file, { contentType: mimeType, upsert: false });
      if (error) throw new Error(`Não foi possível enviar ${file.name}: ${error.message}`);
      try {
        await run(supabase.from('professional_documents').insert({ professional_id: professionalId, title: file.name,
          storage_path: path, size_bytes: file.size, mime_type: mimeType }).select('id').single());
      } catch (failure) { await supabase.storage.from('professional-files').remove([path]); throw failure; }
    },
    professionalDocumentUrl: async (path: string) => {
      const { data, error } = await supabase.storage.from('professional-files').createSignedUrl(path, 60);
      if (error || !data) throw new Error('Não foi possível abrir o anexo.');
      return data.signedUrl;
    },
    deleteProfessionalDocument: async (document: ProfessionalDocument) => {
      await run(supabase.from('professional_documents').delete().eq('id', document.id).select('id').single());
      await supabase.storage.from('professional-files').remove([document.storage_path]);
    },

    users: async (): Promise<UserAccount[]> => {
      const rows = await run<(Omit<UserAccount, 'roles'> & { user_roles: { role: Role }[] })[]>(supabase.from('profiles')
        .select('id, name, email, professional_id, active, user_roles(role)').order('name'));
      // Contas do portal do paciente são geridas na ficha do paciente, não entre as contas da equipe.
      return rows.map(({ user_roles, ...row }) => ({ ...row, roles: user_roles.map((item) => item.role) }))
        .filter((account) => !(account.roles.length && account.roles.every((role) => role === 'patient')));
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
    patientPhotoUrl: async (path: string) => {
      const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 60);
      if (error || !data) throw new Error('Não foi possível abrir a foto.');
      return data.signedUrl;
    },
    uploadPatientPhoto: async (patientId: string, file: File) => {
      if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2 * 1024 * 1024)
        throw new Error('A foto deve ser JPG ou PNG e ter até 2 MB.');
      const path = `patients/${patientId}/photo/${crypto.randomUUID()}.${file.type === 'image/png' ? 'png' : 'jpg'}`;
      const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(`Não foi possível enviar a foto: ${error.message}`);
      try { await run(supabase.rpc('set_patient_photo', { p_patient_id: patientId, p_path: path })); }
      catch (failure) { await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]); throw failure; }
      return path;
    },
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

    appointment: async (id: string) => {
      const rows = await run<AppointmentRow[]>(supabase.from('appointments').select(APPOINTMENT_COLUMNS).eq('id', id));
      return rows[0] ? toAppointment(rows[0]) : null;
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
      .select('note_deadline_hours, missed_charge_percent, late_cancel_hours, late_cancel_charge_percent, google_event_title, whatsapp_confirm_hours, whatsapp_reminder_hours, portal_enabled, portal_url, require_mfa').single()),
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
    financeForecast: (months = 12) => run<FinanceForecastRow[]>(supabase.rpc('finance_forecast', { p_months: months })),
    expenseBreakdown: (year: number) => run<{ dimension: 'cost_center' | 'category'; name: string; amount: number }[]>(
      supabase.rpc('expense_breakdown', { p_year: year })),
    updateSettings: (input: Partial<Omit<ClinicSettings, 'portal_enabled' | 'portal_url' | 'require_mfa'>>) => run<unknown>(supabase.from('clinic_settings')
      .update({ ...input, updated_at: new Date().toISOString() }).eq('id', true).select('id').single()),
    // Sessões realizadas sem evolução: todas para quem vê a agenda geral, só as próprias para a profissional.
    pendingNotes: () => run<PendingNote[]>(supabase.rpc('pending_clinical_notes')),

    // Atividades dos pacientes. A profissional vê sua carteira; a proprietária vê todas.
    patientActivityPatients: () => run<{ id: string; name: string }[]>(supabase.rpc('patient_activity_patients')),
    patientActivityProfessionals: (patientId: string) => run<{ id: string; name: string }[]>(supabase.rpc('patient_activity_professionals', { p_patient_id: patientId })),
    patientActivities: (patientId?: string) => run<PatientActivity[]>(supabase.rpc('patient_activity_list', { p_patient_id: patientId ?? null })),
    patientFormTemplates: () => run<PatientFormTemplate[]>(supabase.rpc('patient_form_templates_list')),
    savePatientFormTemplate: (id: string | null, title: string, description: string, kind: PatientFormKind,
      questions: PatientFormQuestion[]) => run<string>(supabase.rpc('save_patient_form_template', {
        p_id: id, p_title: title, p_description: description, p_kind: kind, p_questions: questions })),
    assignPatientForm: (templateId: string, patientId: string, dueDate: string | null) =>
      run<string>(supabase.rpc('assign_patient_form', { p_template_id: templateId, p_patient_id: patientId, p_due_date: dueDate })),
    cancelPatientForm: (id: string) => run<unknown>(supabase.rpc('cancel_patient_form', { p_id: id })),
    patientFormAssignments: (patientId?: string) => run<PatientFormAssignment[]>(
      supabase.rpc('patient_form_assignments_list', { p_patient_id: patientId ?? null })),
    clinicalPatientFormResults: (patientId: string) => run<PatientFormResult[]>(
      supabase.rpc('clinical_patient_form_results', { p_patient_id: patientId })),
    patientWhatsappTaskSources: (patientId: string) => run<PatientWhatsappTaskSource[]>(
      supabase.rpc('patient_whatsapp_task_sources', { p_patient_id: patientId })),
    transcribePatientWhatsappAudio: (messageId: string) => invoke<{ text: string }>('patient-task-audio',
      { messageId }, 'Não foi possível transcrever o áudio.'),
    savePatientActivity: (id: string | null, patientId: string, title: string, instructions: string, dueDate: string | null,
      professionalId: string | null = null, checklist: { id?: string; text: string }[] = []) =>
      run<string>(supabase.rpc('save_patient_activity_with_checklist', { p_id: id, p_patient_id: patientId, p_title: title,
        p_instructions: instructions, p_due_date: dueDate, p_professional_id: professionalId, p_checklist: checklist })),
    savePatientActivityFromWhatsapp: (id: string | null, patientId: string, title: string, instructions: string,
      dueDate: string | null, professionalId: string | null, checklist: { id?: string; text: string }[], messageId: string) =>
      run<string>(supabase.rpc('save_patient_activity_from_whatsapp', { p_id: id, p_patient_id: patientId,
        p_title: title, p_instructions: instructions, p_due_date: dueDate, p_professional_id: professionalId,
        p_checklist: checklist, p_message_id: messageId })),
    cancelPatientActivity: (id: string) => run<unknown>(supabase.rpc('cancel_patient_activity', { p_id: id })),

    // Tarefas. Regras de quem vê, edita e atribui ficam nas funções do banco.
    tasks: (scope: TaskScope, open: boolean) => run<Task[]>(supabase.rpc('task_list', { p_scope: scope, p_open: open })),
    task: async (id: string) => (await run<Task[]>(supabase.rpc('task_list', { p_scope: 'mine', p_open: false, p_task_id: id })))[0] ?? null,
    taskHistory: (id: string) => run<TaskEvent[]>(supabase.rpc('task_history', { p_task_id: id })),
    taskAssignees: () => run<{ id: string; name: string }[]>(supabase.rpc('task_assignees')),
    taskCounts: async () => (await run<TaskCounts[]>(supabase.rpc('task_counts')))[0],
    saveTask: (id: string | null, input: TaskInput) => run<string>(supabase.rpc('save_task', {
      p_id: id, p_title: input.title, p_description: input.description, p_assignee_id: input.assigneeId, p_priority: input.priority,
      p_due_date: input.dueDate, p_due_time: input.dueTime, p_patient_id: input.patientId
    })),
    // Devolve a próxima ocorrência quando a tarefa recorrente é concluída.
    setTaskStatus: (id: string, status: TaskStatus) => run<string | null>(supabase.rpc('set_task_status', { p_id: id, p_status: status })),
    commentTask: (id: string, body: string) => run<unknown>(supabase.rpc('comment_task', { p_id: id, p_body: body })),
    recurrences: () => run<TaskRecurrence[]>(supabase.rpc('recurrence_list')),
    saveRecurrence: (id: string | null, input: Omit<TaskInput, 'dueDate'> & { frequency: TaskFrequency; startsOn: string }) =>
      run<string>(supabase.rpc('save_recurrence', {
        p_id: id, p_title: input.title, p_description: input.description, p_assignee_id: input.assigneeId, p_priority: input.priority,
        p_patient_id: input.patientId, p_frequency: input.frequency, p_starts_on: input.startsOn, p_due_time: input.dueTime
      })),
    setRecurrenceActive: (id: string, active: boolean) => run<unknown>(supabase.rpc('set_recurrence_active', { p_id: id, p_active: active })),
    notifications: () => run<AppNotification[]>(supabase.from('notifications')
      .select('id, kind, title, link, read_at, created_at').order('created_at', { ascending: false }).limit(20)),
    markNotificationsRead: (ids?: string[]) => run<unknown>(supabase.rpc('mark_notifications_read', { p_ids: ids ?? null })),

    // Comercial (CRM). Leads só mudam por funções do banco, que registram a linha do tempo.
    leads: (since?: string) => {
      const query = supabase.from('leads').select('*').order('last_activity_at', { ascending: false }).limit(2000);
      return run<Lead[]>(since ? query.gte('last_activity_at', since) : query);
    },
    lead: async (id: string) => (await run<Lead[]>(supabase.from('leads').select('*').eq('id', id)))[0] ?? null,
    patientLeads: (patientId: string) => run<Lead[]>(supabase.from('leads').select('*')
      .eq('patient_id', patientId).order('converted_at', { ascending: false })),
    leadActivities: (id: string) => run<LeadActivity[]>(supabase.from('lead_activities').select('*').eq('lead_id', id).order('created_at').order('id')),
    leadAssessments: (leadId: string) => run<LeadAssessment[]>(supabase.rpc('lead_assessment_list', { p_lead_id: leadId })),
    patientProfessionalHistory: (patientId: string) => run<PatientProfessionalEvent[]>(
      supabase.rpc('patient_professional_history', { p_patient_id: patientId })),
    scheduleLeadAssessment: (leadId: string, professionalId: string, startsAt: string, endsAt: string) =>
      run<string>(supabase.rpc('schedule_lead_assessment', { p_lead_id: leadId, p_professional_id: professionalId,
        p_starts_at: startsAt, p_ends_at: endsAt })),
    setLeadAssessmentStatus: (id: string, status: 'attended' | 'missed' | 'cancelled') =>
      run<unknown>(supabase.rpc('set_lead_assessment_status', { p_id: id, p_status: status })),
    saveLead: (id: string | null, input: LeadInput) => run<string>(supabase.rpc('save_lead', { p_id: id, p_data: input })),
    moveLead: (id: string, stageId: string, lossReasonId: string | null, note: string) =>
      run<unknown>(supabase.rpc('move_lead', { p_id: id, p_stage_id: stageId, p_loss_reason_id: lossReasonId, p_note: note })),
    addLeadActivity: (id: string, kind: string, body: string) => run<unknown>(supabase.rpc('add_lead_activity', { p_id: id, p_kind: kind, p_body: body })),
    scheduleFollowup: (id: string, date: string, time: string | null, assigneeId: string) =>
      run<string>(supabase.rpc('schedule_lead_followup', { p_id: id, p_due_date: date, p_due_time: time, p_assignee_id: assigneeId })),
    cancelLeadFollowup: (id: string, reason: string) =>
      run<unknown>(supabase.rpc('cancel_lead_followup', { p_id: id, p_reason: reason })),
    convertLead: (id: string, patientId: string | null, professionalIds: string[]) =>
      run<string>(supabase.rpc('convert_lead', { p_id: id, p_patient_id: patientId, p_professional_ids: professionalIds })),
    leadDuplicates: (phone: string, email: string, exclude: string | null) =>
      run<LeadDuplicate[]>(supabase.rpc('lead_duplicates', { p_phone: phone, p_email: email, p_exclude: exclude })),
    importLeads: (rows: ImportRow[], defaultSourceId: string | null) =>
      run<{ inserted: number; skipped: number; invalid: number }>(supabase.rpc('import_leads', { p_rows: rows, p_default_source_id: defaultSourceId })),
    leadStages: () => run<LeadStage[]>(supabase.from('lead_stages').select('id, name, position, kind, active').order('position')),
    saveStage: (stage: { id: string | null; name: string; position: number; active: boolean }) => stage.id
      ? run<unknown>(supabase.from('lead_stages').update({ name: stage.name, position: stage.position, active: stage.active }).eq('id', stage.id).select('id').single())
      : run<unknown>(supabase.from('lead_stages').insert({ name: stage.name, position: stage.position, kind: 'open' }).select('id').single()),
    leadSources: () => run<NamedItem[]>(supabase.from('lead_sources').select('id, name, active').order('name')),
    lossReasons: () => run<NamedItem[]>(supabase.from('lead_loss_reasons').select('id, name, active').order('name')),
    saveCrmItem: (table: 'lead_sources' | 'lead_loss_reasons', item: { id: string | null; name: string; active: boolean }) => item.id
      ? run<unknown>(supabase.from(table).update({ name: item.name, active: item.active }).eq('id', item.id).select('id').single())
      : run<unknown>(supabase.from(table).insert({ name: item.name }).select('id').single()),
    campaigns: () => run<Campaign[]>(supabase.rpc('campaign_stats')),
    campaignOptions: () => run<{ id: string; name: string; active: boolean }[]>(supabase.from('campaigns').select('id, name, active').order('name')),
    saveCampaign: (id: string | null, input: CampaignInput) => id
      ? run<unknown>(supabase.from('campaigns').update(input).eq('id', id).select('id').single())
      : run<unknown>(supabase.from('campaigns').insert(input).select('id').single()),
    crmSettings: async () => (await run<{ default_owner_id: string | null }[]>(supabase.from('crm_settings').select('default_owner_id')))[0] ?? { default_owner_id: null },
    saveCrmSettings: (ownerId: string | null) => run<unknown>(supabase.from('crm_settings')
      .update({ default_owner_id: ownerId, updated_at: new Date().toISOString() }).eq('id', true).select('id').single()),
    crmOwners: () => run<{ id: string; name: string }[]>(supabase.rpc('crm_owners')),
    crmSummary: (from: string, to: string) => run<CrmSummary>(supabase.rpc('crm_summary', { p_from: from, p_to: to })),
    crmProfessionalFlow: (from: string, to: string) => run<CrmProfessionalFlow[]>(
      supabase.rpc('crm_professional_flow', { p_from: from, p_to: to })),
    crmMonthly: (year: number) => run<CrmMonth[]>(supabase.rpc('crm_monthly', { p_year: year })),
    setPatientOrigin: (patientId: string, sourceId: string | null, campaignId: string | null) =>
      run<unknown>(supabase.rpc('set_patient_origin', { p_patient_id: patientId, p_source_id: sourceId, p_campaign_id: campaignId })),

    // Relatórios: cada função confere a permissão no banco.
    reportSessions: (from: string, to: string, professionalId: string | null) =>
      run<SessionReportRow[]>(supabase.rpc('report_sessions', { p_from: from, p_to: to, p_professional_id: professionalId })),
    reportPatients: (from: string, to: string, professionalId: string | null) =>
      run<PatientReport>(supabase.rpc('report_patients', { p_from: from, p_to: to, p_professional_id: professionalId })),
    reportTasks: (from: string, to: string) => run<TaskReportRow[]>(supabase.rpc('report_tasks', { p_from: from, p_to: to })),
    reportDre: (from: string, to: string) => run<DreRow[]>(supabase.rpc('report_dre', { p_from: from, p_to: to })),
    reportRevenue: (from: string, to: string) => run<RevenueRow[]>(supabase.rpc('report_revenue', { p_from: from, p_to: to })),
    reportPaymentMethods: (from: string, to: string) => run<PaymentMethodRow[]>(supabase.rpc('report_payment_methods', { p_from: from, p_to: to })),
    reportAging: () => run<AgingRow[]>(supabase.rpc('report_aging')),
    reportExpenses: (from: string, to: string) => run<ExpenseReportRow[]>(supabase.rpc('report_expenses', { p_from: from, p_to: to })),
    reportPayouts: (from: string, to: string) => run<PayoutReportRow[]>(supabase.rpc('report_payouts', { p_from: from, p_to: to })),
    reportCampaigns: (from: string, to: string) => run<CampaignReportRow[]>(supabase.rpc('report_campaigns', { p_from: from, p_to: to })),
    reportPerformance: (from: string, to: string, professionalId: string | null, sourceId: string | null) =>
      run<PerformanceReport>(supabase.rpc('report_performance', { p_from: from, p_to: to,
        p_professional_id: professionalId, p_source_id: sourceId })),
    reportYear: (year: number) => run<YearRow[]>(supabase.rpc('report_year', { p_year: year })),

    // WhatsApp: conversas, respostas (dentro de 24 h), autorizações e configuração.
    whatsappConversations: () => run<WhatsappConversation[]>(supabase.rpc('whatsapp_conversations')),
    whatsappMessages: (phone: string) => run<WhatsappMessage[]>(supabase.from('whatsapp_messages')
      .select('id, direction, kind, body, status, error, created_at').eq('phone', phone).order('created_at').limit(500)),
    whatsappReply: async (phone: string, text: string) => {
      await run<string>(supabase.rpc('queue_whatsapp_reply', { p_phone: phone, p_text: text }));
      // Envia na hora; sem a configuração do WhatsApp, a mensagem fica na fila.
      return invoke<{ sent: number; failed: number }>('whatsapp-send', {}, 'A mensagem ficou na fila: o WhatsApp ainda não foi configurado.')
        .then(() => true, () => false);
    },
    setPatientWhatsapp: (patientId: string, optIn: boolean) => run<unknown>(supabase.rpc('set_patient_whatsapp', { p_patient_id: patientId, p_opt_in: optIn })),
    myWhatsapp: async () => (await run<{ phone: string | null; notify: boolean }[]>(supabase.rpc('my_whatsapp')))[0] ?? { phone: null, notify: false },
    setMyWhatsapp: (phone: string, notify: boolean) => run<unknown>(supabase.rpc('set_my_whatsapp', { p_phone: phone, p_notify: notify })),
    whatsappState: async () => (await run<WhatsappState[]>(supabase.rpc('whatsapp_state')))[0] ?? null,
    setWhatsappSettings: (enabled: boolean, appUrl: string) => run<unknown>(supabase.rpc('set_whatsapp_settings', { p_enabled: enabled, p_app_url: appUrl })),

    // Assistente de IA: autorizações, transcrição, rascunho (Edge Function ai-draft) e revisão.
    aiStatus: (patientId: string) => run<AiStatus>(supabase.rpc('ai_status', { p_patient_id: patientId })),
    acceptAiTerms: () => run<unknown>(supabase.rpc('accept_ai_terms')),
    setAiConsent: (patientId: string, granted: boolean, notes = '') =>
      run<unknown>(supabase.rpc('set_ai_consent', { p_patient_id: patientId, p_granted: granted, p_notes: notes })),
    createAiTranscript: (input: { patientId: string; appointmentId: string | null; source: 'paste' | 'file'; fileName: string | null; content: string; extraTerms: string[] }) =>
      run<string>(supabase.rpc('create_ai_transcript', {
        p_patient_id: input.patientId, p_appointment_id: input.appointmentId, p_source: input.source, p_file_name: input.fileName,
        p_content: input.content, p_extra_terms: input.extraTerms
      })),
    aiGenerate: async (transcriptId: string) => (await invoke<{ runId: string }>('ai-draft', { transcriptId }, 'Não foi possível gerar o rascunho.')).runId,
    aiRun: (runId: string) => run<AiRun>(supabase.rpc('ai_get_run', { p_run_id: runId })),
    aiRuns: (patientId: string) => run<AiRunSummary[]>(supabase.rpc('ai_runs_for_patient', { p_patient_id: patientId })),
    aiUseDraft: (runId: string, body: string) => run<string>(supabase.rpc('ai_use_draft', { p_run_id: runId, p_body: body })),
    aiDiscard: (runId: string) => run<unknown>(supabase.rpc('ai_discard_run', { p_run_id: runId })),
    aiUsage: (month: string) => run<AiUsageRow[]>(supabase.rpc('ai_usage', { p_month: month })),
    setAiSettings: (enabled: boolean, monthlyLimitUsd: number | null, retentionDays: number) =>
      run<unknown>(supabase.rpc('set_ai_settings', { p_enabled: enabled, p_monthly_limit_usd: monthlyLimitUsd, p_retention_days: retentionDays })),

    // Aplicativo: aparelho para receber push.
    registerPushDevice: (token: string, platform: 'ios' | 'android') =>
      run<unknown>(supabase.rpc('register_push_device', { p_token: token, p_platform: platform })),
    unregisterPushDevice: (token: string) => run<unknown>(supabase.rpc('unregister_push_device', { p_token: token })),
    pushState: async () => (await run<{ enabled: boolean; devices: number; last_run_at: string | null; last_error: string | null; queued: number }[]>(
      supabase.rpc('push_state')))[0] ?? null,
    setPushEnabled: (enabled: boolean) => run<unknown>(supabase.rpc('set_push_enabled', { p_enabled: enabled })),

    // Portal do paciente: entrada por código enviado ao e-mail (sem senha). Só contas já convidadas
    // recebem o código (shouldCreateUser: false); a resposta é a mesma exista ou não a conta.
    portalSendCode: async (email: string) => {
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: false } });
      if (error?.status === 429) throw new Error('Muitos pedidos de código. Aguarde alguns minutos e tente de novo.');
    },
    portalVerifyCode: async (email: string, code: string) => {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.replace(/\D/g, ''), type: 'email' });
      if (error) throw new Error(error.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Código inválido ou vencido. Peça um novo código.');
    },
    portalMe: () => run<PortalMe>(supabase.rpc('portal_me')),
    portalAcceptTerms: (version: string) => run<unknown>(supabase.rpc('portal_accept_terms', { p_version: version })),
    portalAppointments: (patientId: string) => run<PortalAppointment[]>(supabase.rpc('portal_appointments', { p_patient_id: patientId })),
    portalPatientActivities: (patientId: string) => run<PatientActivity[]>(supabase.rpc('portal_patient_activities', { p_patient_id: patientId })),
    portalPatientForms: (patientId: string) => run<PatientFormAssignment[]>(
      supabase.rpc('portal_patient_forms', { p_patient_id: patientId })),
    portalSubmitPatientForm: (id: string, answers: Record<string, string>) =>
      run<unknown>(supabase.rpc('portal_submit_patient_form', { p_id: id, p_answers: answers })),
    portalCompletePatientActivity: (id: string, response: string) =>
      run<unknown>(supabase.rpc('portal_complete_patient_activity', { p_id: id, p_response: response || null })),
    portalCompletePatientActivityItem: (id: string, itemId: string) =>
      run<unknown>(supabase.rpc('portal_complete_patient_activity_item', { p_id: id, p_item_id: itemId })),
    portalConfirm: (appointmentId: string) => run<unknown>(supabase.rpc('portal_confirm', { p_appointment_id: appointmentId })),
    portalRequestChange: (appointmentId: string, kind: 'reschedule' | 'cancel', message: string) =>
      run<unknown>(supabase.rpc('portal_request_change', { p_appointment_id: appointmentId, p_kind: kind, p_message: message || null })),
    portalCharges: (patientId: string) => run<PortalCharge[]>(supabase.rpc('portal_charges', { p_patient_id: patientId })),
    portalPayments: (patientId: string) => run<PortalPayment[]>(supabase.rpc('portal_payments', { p_patient_id: patientId })),
    portalNotifyPaid: (chargeId: string, message: string) =>
      run<unknown>(supabase.rpc('portal_notify_paid', { p_charge_id: chargeId, p_message: message || null })),
    portalDocuments: (patientId: string) => run<PortalDocument[]>(supabase.rpc('portal_document_list', { p_patient_id: patientId })),
    // Paciente e equipe: link de 60 s, com o download registrado no banco.
    portalDocumentUrl: async (id: string) =>
      (await invoke<{ url: string }>('portal-document-url', { documentId: id }, 'Não foi possível abrir o documento.')).url,
    // Equipe.
    portalAccessList: (patientId: string) => run<PortalAccess[]>(supabase.rpc('portal_access_list', { p_patient_id: patientId })),
    portalInvite: (patientId: string, email: string, relationship: PortalRelationship) =>
      invoke<{ id: string; created: boolean }>('portal-invite', { patientId, email, relationship }, 'Não foi possível convidar.'),
    revokePortalAccess: (id: string) => run<unknown>(supabase.rpc('revoke_portal_access', { p_id: id })),
    portalSharedDocuments: (patientId: string) =>
      run<PortalSharedDocument[]>(supabase.rpc('portal_documents_for_patient', { p_patient_id: patientId })),
    sharePortalDocument: async (patientId: string, file: File, title: string) => {
      const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
      const path = `patients/${patientId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from(PORTAL_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error(/size|exceed/i.test(error.message) ? 'Arquivo maior que 10 MB.'
        : /mime|type/i.test(error.message) ? 'Tipo de arquivo não aceito. Use PDF, imagem (JPG ou PNG) ou Word (.docx).' : 'Não foi possível enviar o arquivo.');
      try {
        await run(supabase.rpc('share_portal_document', {
          p_patient_id: patientId, p_title: title, p_path: path, p_size: file.size, p_mime: file.type || null
        }));
      } catch (failure) {
        await supabase.storage.from(PORTAL_BUCKET).remove([path]);
        throw failure;
      }
    },
    removePortalDocument: async (id: string) => {
      const path = await run<string>(supabase.rpc('remove_portal_document', { p_id: id }));
      await supabase.storage.from(PORTAL_BUCKET).remove([path]);
    },
    portalRequests: (patientId: string) => run<PortalRequest[]>(supabase.rpc('portal_requests_for_patient', { p_patient_id: patientId })),
    portalState: async () => (await run<PortalState[]>(supabase.rpc('portal_state')))[0] ?? null,
    setPortalSettings: (input: { enabled: boolean; url: string; paymentInstructions: string; assigneeId: string | null; emailEnabled: boolean }) =>
      run<unknown>(supabase.rpc('set_portal_settings', {
        p_enabled: input.enabled, p_url: input.url || null, p_payment_instructions: input.paymentInstructions || null,
        p_assignee_id: input.assigneeId, p_email_enabled: input.emailEnabled
      })),

    googleCalendars: () => run<GoogleCalendar[]>(supabase.rpc('list_google_calendars')),
    googleSyncStatus: async () => (await run<GoogleSyncStatus[]>(supabase.rpc('google_sync_status')))[0] ?? null,
    setGoogleCalendar: (id: string, selected: boolean, pushTarget: boolean) =>
      run<unknown>(supabase.rpc('set_google_calendar', { p_id: id, p_selected: selected, p_push_target: pushTarget })),
    // Endereço de autorização do Google para a profissional conectada.
    googleConnectUrl: async () => (await invoke<{ url: string }>('google-oauth-start', {}, 'Não foi possível iniciar a conexão com o Google.')).url,
    googleSyncNow: () => invoke<{ pushed: number; removed: number; busy: number; failed: number }>('google-sync', {}, 'Não foi possível sincronizar agora.'),
    googleDisconnect: (accountId: string) => invoke<{ ok: boolean; removedEvents: number }>('google-disconnect', { accountId }, 'Não foi possível desconectar.'),
    // Compromissos das profissionais no Google (sem título), no formato dos bloqueios da agenda.
    googleBusy: async (from: Date, to: Date): Promise<ScheduleBlock[]> => {
      const rows = await run<{ id: number; professional_id: string; starts_at: string; ends_at: string; professionals: { name: string } | null }[]>(
        supabase.from('google_busy').select('id, professional_id, starts_at, ends_at, professionals(name)')
          .lt('starts_at', to.toISOString()).gt('ends_at', from.toISOString()));
      return rows.map((row) => ({
        id: `google-${row.id}`, professional_id: row.professional_id, professional_name: row.professionals?.name ?? '', starts_at: row.starts_at,
        ends_at: row.ends_at, reason: 'Compromisso no Google Agenda', reason_private: false, can_manage: false, source: 'google'
      }));
    }
  };
  return api;
}
