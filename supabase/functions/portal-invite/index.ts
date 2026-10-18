// Convite para o portal do paciente. Quem gerencia pacientes informa o e-mail do paciente (ou do
// responsável). As regras ficam no banco (portal_prepare_invite, com o token de quem convida); aqui só
// se cria a conta (perfil Paciente, sem senha: a entrada é por código no e-mail) e o vínculo.
import { reply, serveUser, UUID } from '../_shared/admin.ts';

serveUser(async ({ admin, asCaller, caller, input }) => {
  const patientId = typeof input.patientId === 'string' ? input.patientId : '';
  const relationship = input.relationship === 'guardian' ? 'guardian' : input.relationship === 'self' ? 'self' : '';
  if (!UUID.test(patientId)) return reply(400, { error: 'Paciente inválido.' });
  if (!relationship) return reply(400, { error: 'Informe quem vai acessar.' });

  const { data: prepared, error } = await asCaller.rpc('portal_prepare_invite', {
    p_patient_id: patientId, p_email: typeof input.email === 'string' ? input.email : '', p_relationship: relationship
  });
  if (error || !prepared) return reply(error?.code === '42501' ? 403 : 400, { error: error?.message ?? 'Não foi possível convidar.' });
  const invite = prepared as { email: string; user_id: string | null; name: string };

  let userId = invite.user_id;
  let created = false;
  if (!userId) {
    const { data, error: createError } = await admin.auth.admin.createUser({
      email: invite.email, email_confirm: true, user_metadata: { name: invite.name }, app_metadata: { roles: ['patient'] }
    });
    if (createError || !data.user) {
      if (createError?.code === 'email_exists') return reply(409, { error: 'Este e-mail acabou de ser cadastrado. Tente de novo.' });
      console.error(createError);
      return reply(500, { error: 'Não foi possível criar o acesso.' });
    }
    userId = data.user.id;
    created = true;
    await admin.from('audit_log').update({ actor_user_id: caller.id })
      .eq('entity_type', 'user').eq('entity_id', userId).is('actor_user_id', null);
  }

  const { data: accessId, error: grantError } = await admin.rpc('portal_grant_access', {
    p_patient_id: patientId, p_user_id: userId, p_relationship: relationship, p_actor: caller.id
  });
  if (grantError) {
    console.error(grantError);
    // Conta criada agora e sem vínculo: não fica para trás.
    if (created) await admin.auth.admin.deleteUser(userId);
    return reply(500, { error: 'Não foi possível criar o acesso.' });
  }
  return reply(201, { id: accessId, created });
});
