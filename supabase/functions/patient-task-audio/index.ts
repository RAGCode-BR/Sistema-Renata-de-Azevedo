// Transcreve um áudio do número oficial após pedido de profissional autorizada.
// A tarefa só é enviada depois da revisão humana no sistema.
import { reply, serveUser, UUID } from '../_shared/admin.ts';
import { whatsappConfig } from '../_shared/whatsapp.ts';

serveUser(async ({ admin, asCaller, input }) => {
  const messageId = typeof input.messageId === 'string' ? input.messageId : '';
  if (!UUID.test(messageId)) return reply(400, { error: 'Mensagem inválida.' });
  const { data: mediaId, error: accessError } = await asCaller.rpc('prepare_patient_whatsapp_audio', { p_message_id: messageId });
  if (accessError || !mediaId) return reply(403, { error: accessError?.message ?? 'Áudio não disponível.' });
  const key = Deno.env.get('OPENAI_API_KEY');
  const config = whatsappConfig();
  if (!key || !config.token) return reply(503, { error: 'A transcrição de áudios ainda não foi configurada.' });
  try {
    const metadata = await fetch(`${config.apiUrl}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${config.token}` }
    });
    if (!metadata.ok) return reply(502, { error: 'Não foi possível localizar o áudio no WhatsApp.' });
    const details = await metadata.json() as { url?: string; mime_type?: string; file_size?: number };
    const mediaUrl = details.url ? new URL(details.url) : null;
    if (!mediaUrl || mediaUrl.protocol !== 'https:' || !/(\.facebook\.com|\.whatsapp\.net|\.fbsbx\.com)$/.test(mediaUrl.hostname))
      return reply(502, { error: 'Endereço do áudio inválido.' });
    if ((details.file_size ?? 0) > 25 * 1024 * 1024) return reply(413, { error: 'O áudio excede 25 MB.' });
    const download = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${config.token}` } });
    if (!download.ok) return reply(502, { error: 'Não foi possível baixar o áudio.' });
    const bytes = await download.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024)
      return reply(413, { error: 'O áudio está vazio ou excede 25 MB.' });
    const mime = details.mime_type?.split(';')[0] ?? 'audio/ogg';
    const extension = mime.includes('mpeg') ? 'mp3' : mime.includes('mp4') ? 'mp4' : mime.includes('webm') ? 'webm' : 'ogg';
    const form = new FormData();
    form.append('model', 'gpt-transcribe');
    form.append('language', 'pt');
    form.append('file', new Blob([bytes], { type: mime }), `mensagem.${extension}`);
    const transcription = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form
    });
    if (!transcription.ok) return reply(502, { error: 'Não foi possível transcrever o áudio. Tente novamente.' });
    const result = await transcription.json() as { text?: string };
    const transcript = result.text?.trim() ?? '';
    if (!transcript || transcript.length > 12000) return reply(422, { error: 'A transcrição está vazia ou longa demais.' });
    const { error: saveError } = await admin.rpc('finish_patient_whatsapp_audio', {
      p_message_id: messageId, p_transcript: transcript
    });
    if (saveError) return reply(500, { error: 'Não foi possível guardar a transcrição.' });
    return reply(200, { text: transcript });
  } catch (error) {
    console.error(error);
    return reply(502, { error: 'Não foi possível processar o áudio.' });
  }
});
