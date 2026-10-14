import type { AppointmentStatus, Modality, Role } from '../../shared/types.ts';

export const roleLabel: Record<Role, string> = { admin: 'Administração', professional: 'Profissional' };
export const modalityLabel: Record<Modality, string> = { presencial: 'Presencial', online: 'On-line' };

export const statusLabel: Record<AppointmentStatus, string> = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  completed: 'Realizada',
  missed: 'Falta',
  cancelled: 'Cancelada'
};

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function dateTime(value: string | null): string {
  return value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

// Datas sem horário (ex.: nascimento) chegam à meia-noite UTC.
export function dateOnly(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—';
}

export function time(value: string): string {
  return new Date(value).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function longDay(value: string): string {
  return new Date(value).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}
