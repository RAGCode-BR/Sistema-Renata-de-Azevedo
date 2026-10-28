// Rótulos e formatos (datas, dinheiro, situações) usados pela web e pelo aplicativo.
import type { AppointmentStatus, DocumentCategory, Frequency, Modality, PatientStatus, SessionType } from './types.ts';

export { roleLabel } from './permissions.ts';
export const modalityLabel: Record<Modality, string> = { presencial: 'Presencial', online: 'On-line' };

export const statusLabel: Record<AppointmentStatus, string> = {
  scheduled: 'Agendada',
  awaiting_confirmation: 'Aguardando confirmação',
  confirmed: 'Confirmada',
  completed: 'Realizada',
  missed: 'Paciente faltou',
  cancelled_by_patient: 'Cancelada pelo paciente',
  cancelled_by_clinic: 'Cancelada pela clínica',
  rescheduled: 'Remarcada'
};

export const sessionTypeLabel: Record<SessionType, string> = {
  individual: 'Individual',
  couple: 'Casal',
  family: 'Família',
  group: 'Grupo',
  assessment: 'Avaliação'
};

export const frequencyLabel: Record<Frequency, string> = { weekly: 'Toda semana', biweekly: 'A cada 2 semanas', monthly: 'Todo mês' };

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

// Dia de um registro com horário (timestamptz: criado, concluído, respondido…) no fuso da clínica.
// dateOnly é só para colunas de data sem horário: com horário, mostraria o dia seguinte depois das 21 h.
export function dayOf(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';
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

// "hoje", "amanhã", "ontem" ou "seg., 13/10".
export function relativeDay(value: string): string {
  const date = new Date(value);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = startOfToday().getTime();
  if (day === today) return 'hoje';
  if (day === addDays(startOfToday(), 1).getTime()) return 'amanhã';
  if (day === addDays(startOfToday(), -1).getTime()) return 'ontem';
  return date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

// Semana começa na segunda-feira.
export function startOfWeek(date: Date): Date {
  const day = (date.getDay() + 6) % 7;
  return addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), -day);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "2026-10-14", no fuso de quem está usando (para endereços e campos de data).
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function parseDateKey(value: string | null): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

// Valor para <input type="datetime-local">.
export function toLocalInput(date: Date): string {
  return `${dateKey(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function minutesBetween(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}

export const patientStatusLabel: Record<PatientStatus, string> = {
  active: 'Em acompanhamento',
  paused: 'Pausado',
  discharged: 'Alta',
  inactive: 'Encerrado'
};

export const documentCategoryLabel: Record<DocumentCategory, string> = {
  identification: 'Identificação',
  contract: 'Contrato',
  consent: 'Termo de consentimento',
  report: 'Relatório ou declaração',
  other: 'Outro'
};

// Idade completa em anos a partir da data de nascimento (YYYY-MM-DD).
export function age(birthDate: string | null): number | null {
  const birth = parseDateKey(birthDate?.slice(0, 10) ?? null);
  if (!birth) return null;
  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) years -= 1;
  return years;
}

export function formatCpf(cpf: string | null): string {
  return cpf ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—';
}

// Dígitos verificadores do CPF (o banco só confere os 11 dígitos).
export function validCpf(value: string): boolean {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const digit = (length: number) => {
    const sum = [...cpf.slice(0, length)].reduce((total, char, index) => total + Number(char) * (length + 1 - index), 0);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
}

export function fileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

// Tarefas --------------------------------------------------------------------------------------

export const taskStatusLabel: Record<string, string> = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluída', cancelled: 'Cancelada' };
export const taskPriorityLabel: Record<string, string> = { low: 'Baixa', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
export const frequencyTaskLabel: Record<string, string> = {
  daily: 'Todo dia', weekdays: 'Dias úteis', weekly: 'Toda semana', monthly: 'Todo mês', monthly_last: 'Último dia do mês', yearly: 'Todo ano'
};

// Comercial ------------------------------------------------------------------------------------

export const leadActivityLabel: Record<string, string> = {
  created: 'cadastrou o lead', edited: 'editou os dados', assigned: 'mudou o responsável', stage: 'mudou a etapa',
  converted: 'converteu em paciente', call: 'ligação', message: 'mensagem', email: 'e-mail', meeting: 'conversa presencial',
  note: 'anotação', followup: 'agendou retorno', followup_done: 'concluiu retorno',
  followup_cancelled: 'cancelou retorno', site: 'formulário do site',
  assessment_scheduled: 'agendou avaliação', assessment_attended: 'registrou comparecimento à avaliação',
  assessment_missed: 'registrou falta à avaliação', assessment_cancelled: 'cancelou avaliação'
};
export const contactKinds = ['call', 'message', 'email', 'meeting', 'note'] as const;
// Serviços e locais do site (renatadeazevedo.com.br); a lista aceita outros valores.
export const LEAD_INTERESTS = ['Terapia de casal', 'Terapia individual', 'Coaching de relacionamento', 'Terapia de casal homoafetivo', 'Outro'];
export const LEAD_LOCATIONS = ['On-line', 'Barra da Tijuca', 'Botafogo', 'Quinta da Boa Vista', 'São Paulo'];

export function daysSince(value: string): number {
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
}

// Financeiro -----------------------------------------------------------------------------------

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (value: number | null | undefined) => (value === null || value === undefined ? '—' : BRL.format(value));

export const paymentMethodLabel: Record<string, string> = {
  pix: 'PIX', cash: 'Dinheiro', debit: 'Cartão de débito', credit: 'Cartão de crédito', transfer: 'Transferência', boleto: 'Boleto'
};

export const chargeStatusLabel: Record<string, string> = {
  pending: 'Pendente', partial: 'Parcialmente paga', paid: 'Paga', overdue: 'Vencida', cancelled: 'Cancelada', unpriced: 'Valor a definir'
};

// "2026-10-01" (primeiro dia do mês) e rótulos de mês.
export function monthKey(date: Date): string {
  return dateKey(new Date(date.getFullYear(), date.getMonth(), 1));
}
export function monthEnd(key: string): string {
  const start = parseDateKey(key)!;
  return dateKey(new Date(start.getFullYear(), start.getMonth() + 1, 0));
}
export function monthLabel(key: string, style: 'long' | 'short' = 'long'): string {
  const date = parseDateKey(key.slice(0, 10))!;
  const label = date.toLocaleDateString('pt-BR', { month: style, year: 'numeric' }).replace(' de ', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
// Data sem horário (YYYY-MM-DD) para exibição, sem deslocamento de fuso.
export function dayLabel(value: string | null): string {
  const date = parseDateKey(value?.slice(0, 10) ?? null);
  return date ? date.toLocaleDateString('pt-BR') : '—';
}
export const todayKey = () => dateKey(new Date());

// Variação percentual entre dois valores (null quando a base é zero).
export function change(current: number, base: number): number | null {
  return base ? ((current - base) / Math.abs(base)) * 100 : null;
}

// "1.234,56", "150,5" ou "150.50" → número (NaN se inválido).
export function parseMoney(value: string): number {
  const clean = value.trim().replace(/^R\$\s*/, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  return /^-?\d+(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : Number.NaN;
}
