import { FunctionsHttpError } from '@supabase/supabase-js';
import type { PostgrestError } from '@supabase/supabase-js';
import type {
  Appointment, ClinicalNote, GoogleCalendar, NewAppointment, NewClinicalNote, NewPatient, NewProfessional,
  NewUser, Patient, Professional, SessionUser, UserAccount
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

let onSessionEnded = () => {};
let leaving = false;

// Chamado quando a sessão termina sem a pessoa ter clicado em Sair (ex.: expirou em outra aba).
export function setUnauthorizedHandler(handler: () => void): void {
  onSessionEnded = handler;
}

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && !leaving) onSessionEnded();
});

const PATIENT_COLUMNS = 'id, name, phone, email, birth_date, status, patient_professionals(professional_id)';
type PatientRow = Omit<Patient, 'professional_ids'> & { patient_professionals: { professional_id: string }[] };
const toPatient = ({ patient_professionals, ...row }: PatientRow): Patient =>
  ({ ...row, professional_ids: patient_professionals.map((link) => link.professional_id) });

const APPOINTMENT_COLUMNS = 'id, patient_id, professional_id, starts_at, ends_at, status, modality, patients(name), professionals(name)';
type AppointmentRow = Omit<Appointment, 'patient_name' | 'professional_name'> & {
  patients: { name: string } | null;
  professionals: { name: string } | null;
};
const toAppointment = ({ patients, professionals, ...row }: AppointmentRow): Appointment =>
  ({ ...row, patient_name: patients?.name ?? '—', professional_name: professionals?.name ?? '—' });

export const api = {
  // Perfil de quem está conectado; null sem sessão ou com conta inativa.
  session: async (): Promise<SessionUser | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    const profile = await run<(SessionUser & { active: boolean }) | null>(supabase.from('profiles')
      .select('id, name, email, role, professional_id, active').eq('id', session.user.id).maybeSingle());
    return profile?.active ? profile : null;
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

  professionals: () => run<Professional[]>(supabase.from('professionals').select('id, name, email, active').order('name')),
  createProfessional: (input: NewProfessional) => run<Professional>(supabase.from('professionals')
    .insert({ name: input.name, email: input.email || null }).select('id, name, email, active').single()),

  users: () => run<UserAccount[]>(supabase.from('profiles').select('id, name, email, role, professional_id, active').order('name')),
  // Criar e excluir contas exige a chave de serviço: ficam nas Edge Functions (supabase/functions).
  createUser: async (input: NewUser) =>
    (await invoke<{ item: UserAccount }>('admin-create-user', { ...input }, 'Não foi possível criar a conta.')).item,
  deleteUser: async (userId: string) => {
    await invoke('admin-delete-user', { userId }, 'Não foi possível excluir a conta.');
  },

  patients: async () => (await run<PatientRow[]>(supabase.from('patients').select(PATIENT_COLUMNS).order('name'))).map(toPatient),
  createPatient: (input: NewPatient) => run<unknown>(supabase.rpc('create_patient', {
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email,
    p_birth_date: input.birthDate || null,
    p_professional_ids: input.professionalIds
  })),

  appointments: async (from: Date, to: Date) => (await run<AppointmentRow[]>(supabase.from('appointments')
    .select(APPOINTMENT_COLUMNS).gte('starts_at', from.toISOString()).lt('starts_at', to.toISOString())
    .order('starts_at'))).map(toAppointment),
  createAppointment: (input: NewAppointment) => run<unknown>(supabase.from('appointments').insert({
    patient_id: input.patientId,
    professional_id: input.professionalId,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    modality: input.modality
  }).select('id').single()),

  clinicalNotes: (patientId: string) => run<ClinicalNote[]>(supabase.from('clinical_notes')
    .select('id, patient_id, appointment_id, body, created_at').eq('patient_id', patientId).order('created_at', { ascending: false })),
  // A profissional responsável é a da sessão (valor padrão no banco), nunca enviada pela interface.
  createClinicalNote: (input: NewClinicalNote) => run<unknown>(supabase.from('clinical_notes')
    .insert({ patient_id: input.patientId, body: input.body }).select('id').single()),

  googleCalendars: () => run<GoogleCalendar[]>(supabase.rpc('list_google_calendars'))
};
