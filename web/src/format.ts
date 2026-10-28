export * from '../../shared/format.ts';

// Iniciais do nome para o círculo ao lado de pessoas nas listas (primeiro e último nome).
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toLocaleUpperCase('pt-BR');
}
