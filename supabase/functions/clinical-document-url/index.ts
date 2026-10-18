// Link temporário (60 s) para um documento clínico. Só a profissional autora consegue: a checagem e o
// registro da abertura acontecem no banco (authorize_clinical_document, com o token de quem pediu).
// O bucket clinical-documents não tem leitura direta; só esta função, com a chave de serviço, assina links.
import { reply, serveUser, UUID } from '../_shared/admin.ts';

serveUser(async ({ admin, asCaller, input }) => {
  const id = typeof input.documentId === 'string' ? input.documentId : '';
  if (!UUID.test(id)) return reply(400, { error: 'Documento inválido.' });

  const { data: path, error } = await asCaller.rpc('authorize_clinical_document', { p_id: id });
  if (error || typeof path !== 'string') return reply(403, { error: 'O documento é visível apenas para a profissional responsável.' });

  const { data, error: signError } = await admin.storage.from('clinical-documents').createSignedUrl(path, 60);
  if (signError || !data) return reply(500, { error: 'Não foi possível abrir o documento.' });
  return reply(200, { url: data.signedUrl });
});
