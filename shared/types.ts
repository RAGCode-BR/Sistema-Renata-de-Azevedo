// Formato dos dados trocados entre o Supabase e a interface (web e, depois, aplicativo).
// Datas chegam como texto ISO 8601.
import type { Permission, Role } from './permissions.ts';

export type { Permission, Role } from './permissions.ts';

// Quem está conectado: perfis (uma pessoa pode ter vários) e as permissões que eles somam.
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  professional_id: string | null;
  roles: Role[];
  permissions: Permission[];
}

export interface Professional {
  id: string;
  name: string;
  email: string | null;
  specialty: string | null;
  active: boolean;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  roles: Role[];
  professional_id: string | null;
  active: boolean;
}

// Situação do acompanhamento.
export type PatientStatus = 'active' | 'paused' | 'discharged' | 'inactive';

// Cadastro administrativo (nada clínico: prontuário e conceitualização ficam à parte).
export interface Patient {
  id: string;
  name: string;
  social_name: string | null;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  cpf: string | null;
  address: string | null;
  admin_notes: string | null;
  guardian_name: string | null;
  guardian_relationship: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  status: PatientStatus;
  created_at: string;
  professional_ids: string[];
}

export type DocumentCategory = 'identification' | 'contract' | 'consent' | 'report' | 'other';

export interface PatientDocument {
  id: string;
  patient_id: string;
  title: string;
  category: DocumentCategory;
  storage_path: string;
  size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
}

export type AppointmentStatus =
  | 'scheduled' | 'awaiting_confirmation' | 'confirmed' | 'completed' | 'missed'
  | 'cancelled_by_patient' | 'cancelled_by_clinic' | 'rescheduled';
// Modalidade = como acontece (presencial/on-line); tipo = para quem (individual, casal…).
export type Modality = 'presencial' | 'online';
export type SessionType = 'individual' | 'couple' | 'family' | 'group' | 'assessment';
export type Frequency = 'weekly' | 'biweekly' | 'monthly';

// Canceladas e remarcadas liberam o horário (mesma regra do banco: private.occupies_slot).
export const FREE_SLOT_STATUSES: readonly AppointmentStatus[] = ['cancelled_by_patient', 'cancelled_by_clinic', 'rescheduled'];
export const occupiesSlot = (status: AppointmentStatus) => !FREE_SLOT_STATUSES.includes(status);

export interface Appointment {
  id: string;
  patient_id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  modality: Modality;
  session_type: SessionType;
  series_id: string | null;
  rescheduled_from: string | null;
  cancellation_reason: string | null;
  patient_name: string;
  professional_name: string;
}

export interface AppointmentEvent {
  id: number;
  action: 'created' | 'status_changed' | 'updated';
  from_status: AppointmentStatus | null;
  to_status: AppointmentStatus | null;
  reason: string | null;
  created_at: string;
}

// Motivo privado chega como null para quem não pode vê-lo.
export interface ScheduleBlock {
  id: string;
  professional_id: string;
  professional_name: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  reason_private: boolean;
  can_manage: boolean;
}

export interface NewScheduleBlock {
  professionalId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  reasonPrivate: boolean;
}

// Prontuário (lido só pela função clinical_record, que registra o acesso).
// Evolução: rascunho (editável) → finalizada (imutável; correção por retificação).
// Anotação pessoal: da profissional, fora do prontuário formal e da exportação.
export type NoteKind = 'evolution' | 'personal';

export interface ClinicalNote {
  id: string;
  kind: NoteKind;
  status: 'draft' | 'final';
  body: string;
  appointment_id: string | null;
  appointment_starts_at: string | null;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
  rectifies_id: string | null;
  rectification_reason: string | null;
  rectified_by: string | null;
  revisions: number;
}

export interface FormulationSection { key: string; label: string; hint?: string }

export interface FormulationTemplate {
  id: string;
  professional_id: string | null; // nulo = modelo da clínica
  name: string;
  sections: FormulationSection[];
}

export interface CaseFormulation {
  id: string;
  template_name: string;
  sections: FormulationSection[];
  content: Record<string, string>;
  updated_at: string;
  revisions: number;
}

export interface ClinicalDocument {
  id: string;
  title: string;
  size_bytes: number | null;
  mime_type: string | null;
  created_at: string;
}

export interface ClinicalRecord {
  notes: ClinicalNote[];
  formulation: CaseFormulation | null;
  documents: ClinicalDocument[];
}

// Prontuário formal exportado (evoluções finalizadas e retificações; conceitualização opcional).
export interface ClinicalExport {
  patient: { name: string; birth_date: string | null };
  professional: string;
  exported_at: string;
  notes: Pick<ClinicalNote, 'id' | 'body' | 'finalized_at' | 'appointment_starts_at' | 'rectifies_id' | 'rectification_reason'>[];
  formulation: Pick<CaseFormulation, 'template_name' | 'sections' | 'content' | 'updated_at'> | null;
}

// Situação de preenchimento de uma sessão realizada (sem conteúdo clínico).
export type NoteFillStatus = 'pending' | 'draft' | 'final' | 'final_late';

export interface NoteStatusRow {
  appointment_id: string;
  starts_at: string;
  ends_at: string;
  patient_id: string;
  patient_name: string;
  professional_id: string;
  professional_name: string;
  note_status: NoteFillStatus;
  deadline_at: string;
  overdue: boolean;
}

export interface ClinicSettings {
  note_deadline_hours: number;
  missed_charge_percent: number;
  late_cancel_hours: number;
  late_cancel_charge_percent: number;
}

// Financeiro -----------------------------------------------------------------------------------
// Valores em reais (numeric do banco chega como número). Competência = data da sessão/despesa;
// caixa = data do recebimento/pagamento.

// unpriced: sessão sem preço cadastrado; fica em aberto até alguém definir o valor.
export type ChargeStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled' | 'unpriced';
export type PaymentMethod = 'pix' | 'cash' | 'debit' | 'credit' | 'transfer';

export interface Charge {
  id: string;
  patient_id: string;
  patient_name: string;
  professional_id: string | null;
  professional_name: string | null;
  appointment_id: string | null;
  description: string;
  competence_date: string;
  due_date: string;
  amount: number;
  discount: number;
  paid: number;
  balance: number;
  status: ChargeStatus;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  patient_id: string;
  patient_name: string;
  amount: number;
  allocated: number;
  method: PaymentMethod;
  received_at: string;
  notes: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  created_at: string;
}

export interface NewPayment {
  patientId: string;
  amount: number;
  method: PaymentMethod;
  receivedAt: string;
  chargeIds: string[];
  notes: string;
}

export interface NamedItem { id: string; name: string; active: boolean }

export interface Expense {
  id: string;
  description: string;
  supplier: string | null;
  category_id: string;
  cost_center_id: string;
  amount: number;
  competence_date: string;
  due_date: string;
  paid_at: string | null;
  method: PaymentMethod | 'boleto' | null;
  notes: string | null;
}

export interface SessionPrice {
  id: string;
  professional_id: string | null;
  session_type: SessionType | null;
  amount: number;
}

export interface PayoutRow {
  professional_id: string;
  professional_name: string;
  received: number;
  percent: number | null;
  payout: number | null;
  paid_amount: number | null;
  paid_at: string | null;
}

export interface FinanceMonth {
  month: string;
  billed: number;
  received: number;
  expenses_competence: number;
  expenses_paid: number;
  payouts_paid: number;
  cash_result: number;
}

export interface Receivables { open_amount: number; overdue_amount: number; overdue_count: number }

export interface GoogleCalendar {
  id: string;
  professional_id: string;
  display_name: string;
  access_role: string;
  selected: boolean;
  last_synced_at: string | null;
  google_email: string;
  professional_name: string;
}

// Corpos aceitos pelas rotas de cadastro.

export interface NewProfessional { name: string; email: string; specialty: string }

export interface NewUser {
  name: string;
  email: string;
  roles: Role[];
  professionalId: string | null;
  password: string;
}

// Alteração de perfis, profissional vinculada e situação de uma conta existente.
export interface UserAccessUpdate {
  userId: string;
  roles: Role[];
  professionalId: string | null;
  active: boolean;
}

// Campos do cadastro enviados a save_patient (texto vazio apaga o campo).
export type PatientInput = {
  [K in 'name' | 'social_name' | 'phone' | 'email' | 'birth_date' | 'cpf' | 'address' | 'admin_notes'
    | 'guardian_name' | 'guardian_relationship' | 'guardian_phone' | 'guardian_email']: string;
} & { status: PatientStatus; professionalIds: string[] };

export interface NewAppointment {
  patientId: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
  modality: Modality;
  sessionType: SessionType;
  // Sem recorrência: sessão única. Com recorrência: série de `count` sessões.
  recurrence: { frequency: Frequency; count: number } | null;
}

export interface ClinicalNoteInput { id: string | null; patientId: string; appointmentId: string | null; kind: NoteKind; body: string }

// Sessão já realizada que ainda não tem evolução. Não traz conteúdo clínico: só a existência
// da pendência, para a profissional resolver e a gerência acompanhar.
export interface PendingNote {
  appointment_id: string;
  starts_at: string;
  ends_at: string;
  patient_id: string;
  patient_name: string;
  professional_id: string;
  professional_name: string;
  note_status: 'pending' | 'draft';
  overdue: boolean;
}

export interface ItemsResponse<T> { items: T[] }
export interface ItemResponse<T> { item: T }
export interface ErrorResponse { error: string }
