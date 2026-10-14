// Formato dos dados trocados entre o servidor (server/) e a interface (web/).
// Datas chegam como texto ISO 8601.

export type Role = 'admin' | 'professional';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  professional_id: string | null;
}

export interface Professional {
  id: string;
  name: string;
  email: string | null;
  active: boolean;
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  role: Role;
  professional_id: string | null;
  active: boolean;
}

export type PatientStatus = 'active' | 'inactive';

export interface Patient {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  status: PatientStatus;
  professional_ids: string[];
}

export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'missed' | 'cancelled';
export type Modality = 'presencial' | 'online';

export interface Appointment {
  id: string;
  patient_id: string;
  professional_id: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  modality: Modality;
  patient_name: string;
  professional_name: string;
}

export interface ClinicalNote {
  id: string;
  patient_id: string;
  appointment_id: string | null;
  body: string;
  created_at: string;
}

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

export interface NewProfessional { name: string; email: string }

export interface NewUser {
  name: string;
  email: string;
  role: Role;
  professionalId: string | null;
  password: string;
}

export interface NewPatient {
  name: string;
  phone: string;
  email: string;
  birthDate: string;
  professionalIds: string[];
}

export interface NewAppointment {
  patientId: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
  modality: Modality;
}

export interface NewClinicalNote { patientId: string; body: string }

export interface ItemsResponse<T> { items: T[] }
export interface ItemResponse<T> { item: T }
export interface ErrorResponse { error: string }
