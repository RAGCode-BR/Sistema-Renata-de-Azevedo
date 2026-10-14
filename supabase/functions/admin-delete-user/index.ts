// Exclui uma conta (Supabase Auth + perfil). Só a administração pode chamar.
// O que a pessoa registrou continua guardado: evoluções e agenda pertencem à profissional
// (professionals), não à conta, e o registro de auditoria fica sem autor (ON DELETE SET NULL).
// Ninguém exclui a própria conta, o que também garante que sempre reste uma administração.
import { reply, serveAdmin, UUID } from '../_shared/admin.ts';

serveAdmin(async ({ admin, caller, input }) => {
  const userId = typeof input.userId === 'string' ? input.userId : '';
  if (!UUID.test(userId)) return reply(400, { error: 'Usuário inválido.' });
  if (userId === caller.id) return reply(400, { error: 'Você não pode excluir a própria conta.' });

  const { data: target } = await admin.from('profiles').select('id').eq('id', userId).maybeSingle();
  if (!target) return reply(404, { error: 'Usuário não encontrado.' });

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(error);
    return reply(500, { error: 'Não foi possível excluir a conta.' });
  }

  await admin.from('audit_log').insert({ actor_user_id: caller.id, action: 'delete', entity_type: 'user', entity_id: userId });
  return reply(200, { ok: true });
});
