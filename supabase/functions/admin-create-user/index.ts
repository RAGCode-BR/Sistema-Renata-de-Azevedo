// Cria uma conta (Supabase Auth + perfil). Só a administração pode chamar.
// O perfil é criado pelo gatilho on_auth_user_created a partir de app_metadata (papel e profissional),
// que só a chave de serviço consegue definir.
import { reply, serveAdmin, UUID } from '../_shared/admin.ts';

const MIN_PASSWORD_LENGTH = 10; // o mesmo de shared/rules.ts e supabase/config.toml
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (value: unknown, max = 255) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

serveAdmin(async ({ admin, caller, input }) => {
  const name = text(input.name);
  const email = text(input.email).toLowerCase();
  const role = input.role;
  const password = typeof input.password === 'string' ? input.password : '';
  const professionalId = role === 'professional' ? text(input.professionalId) : null;

  if (!name || (role !== 'admin' && role !== 'professional')) return reply(400, { error: 'Dados de conta inválidos.' });
  if (!EMAIL.test(email)) return reply(400, { error: 'Informe um e-mail válido.' });
  if (password.length < MIN_PASSWORD_LENGTH) {
    return reply(400, { error: `A senha inicial precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` });
  }
  if (role === 'professional') {
    if (!professionalId || !UUID.test(professionalId)) return reply(400, { error: 'Profissional inválido.' });
    const { data: professional } = await admin.from('professionals').select('active').eq('id', professionalId).maybeSingle();
    if (!professional?.active) return reply(400, { error: 'Profissional inválido.' });
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('professional_id', professionalId);
    if (count) return reply(409, { error: 'Esta profissional já tem uma conta.' });
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name },
    app_metadata: { role, professional_id: professionalId }
  });
  if (error || !data.user) {
    if (error?.code === 'email_exists') return reply(409, { error: 'Este cadastro já existe.' });
    if (error?.code === 'weak_password') return reply(400, { error: 'Senha fraca. Escolha uma senha mais longa.' });
    console.error(error);
    return reply(500, { error: 'Não foi possível criar a conta.' });
  }

  // O gatilho registra a criação sem autor (chave de serviço); aqui fica registrado quem criou.
  await admin.from('audit_log').update({ actor_user_id: caller.id })
    .eq('entity_type', 'user').eq('entity_id', data.user.id).is('actor_user_id', null);

  const { data: item } = await admin.from('profiles')
    .select('id, name, email, role, professional_id, active').eq('id', data.user.id).single();
  return reply(201, { item });
});
