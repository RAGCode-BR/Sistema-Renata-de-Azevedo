// Exclui uma conta (Supabase Auth + perfil). Só quem gerencia usuários pode chamar.
// O que a pessoa registrou continua guardado: evoluções e agenda pertencem à profissional
// (professionals), não à conta, e o registro de auditoria fica sem autor (ON DELETE SET NULL).
// Ninguém exclui a própria conta, e a última Proprietária ativa não pode ser excluída.
import { reply, serveAdmin, UUID } from '../_shared/admin.ts';

serveAdmin(async ({ admin, caller, input }) => {
  const userId = typeof input.userId === 'string' ? input.userId : '';
  if (!UUID.test(userId)) return reply(400, { error: 'Usuário inválido.' });
  if (userId === caller.id) return reply(400, { error: 'Você não pode excluir a própria conta.' });

  const { data: target } = await admin.from('profiles').select('id, active, user_roles(role)').eq('id', userId).maybeSingle();
  if (!target) return reply(404, { error: 'Usuário não encontrado.' });

  const isOwner = (target.user_roles as { role: string }[]).some((item) => item.role === 'owner');
  if (isOwner && target.active) {
    const { data: owners } = await admin.from('user_roles').select('user_id, profiles!inner(active)')
      .eq('role', 'owner').eq('profiles.active', true).neq('user_id', userId);
    if (!owners?.length) return reply(400, { error: 'É preciso manter ao menos uma Proprietária ativa.' });
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.error(error);
    return reply(500, { error: 'Não foi possível excluir a conta.' });
  }

  await admin.from('audit_log').insert({ actor_user_id: caller.id, action: 'delete', entity_type: 'user', entity_id: userId });
  return reply(200, { ok: true });
});
