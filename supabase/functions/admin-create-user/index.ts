// Cria uma conta (Supabase Auth + perfil + perfis de acesso). Só quem gerencia usuários pode chamar.
// O perfil e os perfis de acesso são criados pelo gatilho on_auth_user_created a partir de
// app_metadata (roles e professional_id), que só a chave de serviço consegue definir.
import { reply, ROLES, serveAdmin, UUID } from '../_shared/admin.ts';

const MIN_PASSWORD_LENGTH = 10; // o mesmo de shared/rules.ts e supabase/config.toml
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (value: unknown, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

serveAdmin(async ({ admin, caller, input }) => {
  const name = text(input.name);
  const email = text(input.email).toLowerCase();
  const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const roles = [...new Set(Array.isArray(input.roles) ? input.roles : [])];
  const professionalId = roles.includes('professional') ? text(input.professionalId) : null;

  if (!name) return reply(400, { error: 'Informe o nome.' });
  if (!EMAIL.test(email)) return reply(400, { error: 'Informe um e-mail válido.' });
  if (username && !/^[a-z][a-z0-9._-]{2,31}$/.test(username))
    return reply(400, { error: 'Login inválido. Use de 3 a 32 letras sem acento, números, ponto, hífen ou sublinhado; comece com uma letra.' });
  if (!roles.length || !roles.every((role) => typeof role === 'string' && ROLES.includes(role))) {
    return reply(400, { error: 'Escolha ao menos um perfil.' });
  }
  if (roles.includes('patient') && roles.length > 1) {
    return reply(400, { error: 'O perfil Paciente não pode ser combinado com perfis da equipe.' });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return reply(400, { error: `A senha inicial precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
  }
  if (roles.includes('professional')) {
    if (!professionalId || !UUID.test(professionalId)) return reply(400, { error: 'O perfil Profissional exige uma profissional vinculada.' });
    const { data: professional } = await admin.from('professionals').select('active').eq('id', professionalId).maybeSingle();
    if (!professional?.active) return reply(400, { error: 'Profissional inválido.' });
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('professional_id', professionalId);
    if (count) return reply(409, { error: 'Esta profissional já tem uma conta.' });
  }
  if (username) {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('username', username);
    if (count) return reply(409, { error: 'Este login já está em uso.' });
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { roles, professional_id: professionalId, ...(username ? { username } : {}) }
  });
  if (error || !data.user) {
    if (error?.code === 'email_exists') return reply(409, { error: 'Este cadastro já existe.' });
    if (error?.message?.includes('profiles_username_unique')) return reply(409, { error: 'Este login já está em uso.' });
    if (error?.code === 'weak_password') return reply(400, { error: 'Senha fraca. Escolha uma senha mais longa.' });
    console.error(error);
    return reply(500, { error: 'Não foi possível criar a conta.' });
  }

  // O gatilho registra a criação sem autor (chave de serviço); aqui fica registrado quem criou.
  await admin.from('audit_log').update({ actor_user_id: caller.id })
    .eq('entity_type', 'user').eq('entity_id', data.user.id).is('actor_user_id', null);
  await admin.from('user_roles').update({ granted_by: caller.id }).eq('user_id', data.user.id);

  return reply(201, { id: data.user.id });
});
