// Link temporário (60 s) para um documento compartilhado no portal. A checagem e o registro do download
// ficam no banco (portal_document_open, com o token de quem pediu): o paciente baixa só o que é dele, e a
// equipe que vê o paciente confere o arquivo. O bucket portal-documents não tem leitura direta.
import { reply, serveUser, UUID } from '../_shared/admin.ts';

serveUser(async ({ admin, asCaller, input }) => {
  const id = typeof input.documentId === 'string' ? input.documentId : '';
  if (!UUID.test(id)) return reply(400, { error: 'Documento inválido.' });

  const { data: path, error } = await asCaller.rpc('portal_document_open', { p_id: id });
  if (error || typeof path !== 'string') return reply(403, { error: error?.message ?? 'Documento indisponível.' });

  const { data, error: signError } = await admin.storage.from('portal-documents').createSignedUrl(path, 60);
  if (signError || !data) return reply(500, { error: 'Não foi possível abrir o documento.' });
  return reply(200, { url: data.signedUrl });
});
