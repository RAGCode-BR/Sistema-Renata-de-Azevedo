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
  source_id: string | null;
  campaign_id: string | null;
  // Autorização (LGPD) para confirmações e lembretes pelo WhatsApp.
  whatsapp_opt_in: boolean;
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
  // Link do Google Meet (sessões on-line com a agenda Google conectada).
  meeting_url: string | null;
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
  // 'google': compromisso da profissional no Google Agenda (sem título; só leitura).
  source?: 'google';
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
  google_event_title: 'initials' | 'generic' | 'full';
  whatsapp_confirm_hours: number;
  whatsapp_reminder_hours: number;
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

// Tarefas -------------------------------------------------------------------------------------
// Lidas e gravadas só por funções do banco. Nome do paciente vem nulo para quem não o vê.

export type TaskStatus = 'todo' | 'doing' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TaskFrequency = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'monthly_last' | 'yearly';
export type TaskScope = 'mine' | 'created' | 'team';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  created_by: string | null;
  creator_name: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  due_time: string | null;
  overdue: boolean;
  patient_id: string | null;
  patient_name: string | null;
  recurrence_id: string | null;
  frequency: TaskFrequency | null;
  completed_at: string | null;
  completed_by_name: string | null;
  created_at: string;
  can_edit: boolean;
  comments: number;
  lead_id: string | null;
  lead_name: string | null;
}

export interface TaskInput {
  title: string;
  description: string;
  assigneeId: string;
  priority: TaskPriority;
  dueDate: string | null;
  dueTime: string | null;
  patientId: string | null;
}

export interface TaskEvent {
  id: number;
  actor_name: string | null;
  kind: 'created' | 'edited' | 'assigned' | 'status' | 'comment';
  body: string | null;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}

export interface TaskRecurrence {
  id: string;
  title: string;
  description: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  priority: TaskPriority;
  patient_id: string | null;
  patient_name: string | null;
  frequency: TaskFrequency;
  starts_on: string;
  due_time: string | null;
  active: boolean;
  created_by: string | null;
  creator_name: string | null;
  next_due: string | null;
  can_edit: boolean;
}

export interface TaskCounts { open_count: number; due_today: number; overdue: number; team_overdue: number | null; unread: number }

export interface AppNotification {
  id: string;
  kind: 'task_assigned' | 'task_done' | 'task_comment' | 'lead_new' | 'lead_assigned' | 'message_new';
  title: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

// Comercial (CRM) -------------------------------------------------------------------------------

export type StageKind = 'open' | 'won' | 'lost';
export interface LeadStage { id: string; name: string; position: number; kind: StageKind; active: boolean }

export interface Lead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source_id: string | null;
  campaign_id: string | null;
  stage_id: string;
  owner_id: string | null;
  interest: string | null;
  location: string | null;
  preferred_professional_id: string | null;
  notes: string | null;
  loss_reason_id: string | null;
  patient_id: string | null;
  converted_at: string | null;
  next_contact_at: string | null;
  first_contact_at: string | null;
  last_activity_at: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  landing_page: string | null;
  consent_at: string | null;
  anonymized_at: string | null;
  created_at: string;
}

export interface LeadInput {
  name: string; phone: string; email: string; source_id: string; campaign_id: string; interest: string; location: string;
  preferred_professional_id: string; owner_id: string; notes: string;
}

export type LeadActivityKind = 'created' | 'edited' | 'assigned' | 'stage' | 'converted' | 'call' | 'message' | 'email'
  | 'meeting' | 'note' | 'followup' | 'site';
export interface LeadActivity {
  id: number; lead_id: string; actor_id: string | null; kind: LeadActivityKind; body: string | null;
  from_value: string | null; to_value: string | null; created_at: string;
}

export interface LeadDuplicate { kind: 'lead' | 'patient'; id: string; name: string; detail: string | null }

export interface Campaign {
  id: string; name: string; source_id: string | null; source_name: string | null; utm_campaign: string | null;
  starts_on: string | null; ends_on: string | null; budget: number; notes: string | null; active: boolean;
  leads: number; converted: number; attended: number; revenue: number | null; cost_per_lead: number | null; cost_per_patient: number | null;
}
export type CampaignInput = Pick<Campaign, 'name' | 'source_id' | 'utm_campaign' | 'starts_on' | 'ends_on' | 'budget' | 'notes' | 'active'>;

export interface CrmBreakdown { name: string; leads: number; converted: number; lost: number; attended: number; revenue: number | null }
export interface CrmSummary {
  leads: number; converted: number; lost: number; open: number; attended: number; revenue: number | null;
  avg_first_contact_hours: number | null; new_patients: number;
  by_source: CrmBreakdown[]; loss_reasons: { name: string; count: number }[];
  stages: { name: string; kind: StageKind; position: number; count: number }[];
}
export interface CrmMonth { month: string; leads: number; converted: number; new_patients: number }

export interface ImportRow { name: string; phone: string; email: string; source: string; campaign: string; stage: string; created_at: string; notes: string }

// Relatórios -------------------------------------------------------------------------------------

export interface SessionReportRow {
  professional_id: string; professional_name: string; session_type: SessionType; modality: Modality;
  total: number; completed: number; missed: number; cancelled_by_patient: number; late_cancel: number; cancelled_by_clinic: number;
  rescheduled: number; unrecorded: number; upcoming: number; completed_minutes: number;
}
export interface RetentionRow { professional_id: string; name: string; started: number; eligible_4: number; kept_4: number; eligible_12: number; kept_12: number }
export interface PatientReport {
  status: Record<PatientStatus, number>;
  registered: number;
  retention: RetentionRow[];
}
export interface TaskReportRow { assignee_id: string | null; assignee_name: string; created: number; done: number; done_on_time: number; open_now: number; overdue_now: number }
export interface DreRow {
  month: string; billed: number; discounts: number; received: number; expenses_competence: number; expenses_paid: number;
  payouts_competence: number; payouts_paid: number; categories: Record<string, number>;
}
export interface RevenueRow { professional_id: string | null; professional_name: string | null; session_type: SessionType | null; charges: number; billed: number; received: number }
export interface PaymentMethodRow { method: string; payments: number; amount: number; reversed: number }
export interface AgingRow {
  patient_id: string; patient_name: string; phone: string | null; not_due: number; up_to_30: number; up_to_60: number; over_60: number;
  total: number; oldest_due: string;
}
export interface ExpenseReportRow { dimension: 'category' | 'cost_center'; name: string; competence: number; paid: number }
export interface PayoutReportRow { month: string; professional_id: string; professional_name: string; received: number; percent: number | null; payout: number | null; paid_at: string | null }
export interface CampaignReportRow { id: string; name: string; source_name: string | null; budget: number; leads: number; converted: number; lost: number; attended: number; revenue: number | null }
export interface YearRow {
  month: string; billed: number | null; received: number | null; expenses_paid: number | null; cash_result: number | null;
  completed: number | null; missed: number | null; cancelled: number | null; new_patients: number | null; leads: number | null; converted: number | null;
}

export interface GoogleCalendar {
  id: string;
  professional_id: string;
  display_name: string;
  access_role: 'owner' | 'writer' | 'reader' | 'freeBusyReader';
  selected: boolean;
  push_target: boolean;
  last_synced_at: string | null;
  google_account_id: string;
  google_email: string;
  professional_name: string;
  can_edit: boolean;
}

export interface WhatsappConversation {
  phone: string; name: string; kind: 'patient' | 'lead' | 'staff' | 'unknown'; ref_id: string | null; last_body: string;
  last_at: string; last_direction: 'in' | 'out'; last_inbound_at: string | null; unanswered: boolean;
}
export interface WhatsappMessage {
  id: string; direction: 'in' | 'out'; kind: string; body: string; status: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';
  error: string | null; created_at: string;
}
export interface WhatsappState { enabled: boolean; app_url: string | null; last_run_at: string | null; last_error: string | null; queued: number; failed_today: number }

// Assistente de IA (desligado até a configuração; rascunhos sempre revisados pela profissional) ---------

export interface AiStatus {
  clinic_enabled: boolean; terms_version: string; terms_accepted: boolean; consent_at: string | null; consent_notes: string | null;
  limit_reached: boolean; blocker: string | null;
}
export interface AiItem { text: string; evidence: string[] }
export interface AiDraft {
  summary: AiItem | null; topics: AiItem[];
  evolution: { themes: AiItem[]; interventions: AiItem[]; observations: AiItem[]; agreements: AiItem[] };
  admin_tasks: AiItem[]; gaps: string[];
}
export interface AiRun {
  id: string; status: 'pending' | 'done' | 'failed'; model: string | null; redacted_text: string | null; result: AiDraft | null;
  warnings: string[]; error: string | null; cost_usd: number; decision: 'used' | 'discarded' | null; note_id: string | null;
  created_at: string; appointment_id: string | null;
}
export interface AiRunSummary { id: string; status: AiRun['status']; decision: AiRun['decision']; note_id: string | null; created_at: string; cost_usd: number; available: boolean }
export interface AiUsageRow { enabled: boolean; monthly_limit_usd: number | null; retention_days: number; month_cost: number; professional_name: string | null; runs: number | null; cost_usd: number | null }

export interface GoogleSyncStatus { enabled: boolean; last_run_at: string | null; last_error: string | null; pending: number; failing: number }

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
