import type {
  Appointment, ClinicalNote, ErrorResponse, GoogleCalendar, ItemResponse, ItemsResponse, NewAppointment,
  NewClinicalNote, NewPatient, NewProfessional, NewUser, Patient, Professional, SessionUser, UserAccount
} from '../../shared/types.ts';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized = () => {};

// Chamado quando a sessão expira no meio do uso, para voltar à tela de login.
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'clinic-local', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, 'Servidor indisponível.');
  }
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/session') onUnauthorized();
    throw new ApiError(response.status, (data as Partial<ErrorResponse>).error || 'Falha na comunicação com o servidor.');
  }
  return data as T;
}

const items = <T>(path: string) => request<ItemsResponse<T>>(path).then((data) => data.items);
const create = <T>(path: string, body: unknown) => request<ItemResponse<T>>(path, 'POST', body).then((data) => data.item);

export const api = {
  session: () => request<{ user: SessionUser | null }>('/api/session').then((data) => data.user),
  login: (email: string, password: string) => request<unknown>('/api/session', 'POST', { email, password }),
  logout: () => request<unknown>('/api/session', 'DELETE'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<unknown>('/api/me/password', 'PATCH', { currentPassword, newPassword }),

  professionals: () => items<Professional>('/api/professionals'),
  createProfessional: (input: NewProfessional) => create<Professional>('/api/professionals', input),

  users: () => items<UserAccount>('/api/users'),
  createUser: (input: NewUser) => create<UserAccount>('/api/users', input),

  patients: () => items<Patient>('/api/patients'),
  createPatient: (input: NewPatient) => create<Patient>('/api/patients', input),

  appointments: (from: Date, to: Date) => items<Appointment>(
    `/api/appointments?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  createAppointment: (input: NewAppointment) => create<Appointment>('/api/appointments', input),

  clinicalNotes: (patientId: string) => items<ClinicalNote>(`/api/clinical-notes?patientId=${encodeURIComponent(patientId)}`),
  createClinicalNote: (input: NewClinicalNote) => create<ClinicalNote>('/api/clinical-notes', input),

  googleCalendars: () => items<GoogleCalendar>('/api/google-calendars')
};
