// Perfis e permissões: os mesmos nomes de supabase/migrations (user_roles e role_permissions).
// Usado pela web e, depois, pelo aplicativo. Quem decide o acesso é o banco (RLS);
// aqui ficam só os nomes, os rótulos e a checagem usada para montar menus e botões.

export const ROLES = ['owner', 'manager', 'reception', 'finance', 'professional', 'patient'] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES = ROLES.filter((role) => role !== 'patient');

export type Permission =
  | 'users.manage'
  | 'professionals.manage'
  | 'patients.view_all'
  | 'patients.manage'
  | 'appointments.view_all'
  | 'appointments.manage'
  | 'calendars.view_all'
  | 'billing.view'
  | 'billing.manage'
  | 'finance.view'
  | 'finance.manage'
  | 'settings.manage'
  | 'tasks.manage'
  | 'patient_activities.manage_all'
  | 'crm.view'
  | 'crm.manage'
  | 'messages.manage';

export const roleLabel: Record<Role, string> = {
  owner: 'Proprietário(a)',
  manager: 'Gerente',
  reception: 'Recepção',
  finance: 'Financeiro',
  professional: 'Profissional',
  patient: 'Paciente'
};

export const roleDescription: Record<Role, string> = {
  owner: 'Tudo o que é administrativo, inclusive usuários. Não vê prontuários de outras profissionais.',
  manager: 'Agenda geral, pacientes, profissionais, cobranças, comercial e tarefas da equipe. Sem usuários, resultado financeiro e prontuários.',
  reception: 'Pacientes, agenda, cobranças e comercial (leads). Sem prontuários.',
  finance: 'Financeiro completo: cobranças, despesas, resultado e repasses. Sem prontuários.',
  professional: 'Os próprios pacientes, a própria agenda e o próprio prontuário.',
  patient: 'Só o portal do paciente: as próprias sessões, cobranças e documentos compartilhados.'
};

export function can(access: { permissions: readonly string[] }, permission: Permission): boolean {
  return access.permissions.includes(permission);
}
