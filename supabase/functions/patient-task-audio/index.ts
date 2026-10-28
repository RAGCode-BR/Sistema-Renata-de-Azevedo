// Transcreve um áudio do número oficial a pedido da profissional responsável.
// As regras ficam no banco (prepare_patient_whatsapp_audio, com o token de quem pediu): mesmas do assistente
// de IA (IA ligada, limite mensal, termo da profissional, consentimento do paciente), uma transcrição por
// áudio e registro no acesso clínico. A tarefa só é enviada depois da revisão humana no sistema.
// Segredos: OPENAI_API_KEY; opcionais TRANSCRIBE_MODEL e TRANSCRIBE_USD_PER_MINUTE (para o limite de custo).
import { reply, serveUser, UUID } from '../_shared/admin.ts';
import { whatsappConfig } from '../_shared/whatsapp.ts';

const MAX_BYTES = 25 * 1024 * 1024;
// Formatos aceitos pela transcrição da OpenAI (o WhatsApp manda áudio de voz em ogg/opus).
const EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a',
  'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/x-wav': 'wav'
};

serveUser(async ({ admin, asCaller, input }) => {
  const messageId = typeof input.messageId === 'string' ? input.messageId : '';
  if (!UUID.test(messageId)) return reply(400, { error: 'Mensagem inválida.' });
  const key = Deno.env.get('OPENAI_API_KEY');
  const config = whatsappConfig();
  if (!key || !config.token) return reply(503, { error: 'A transcrição de áudios ainda não foi configurada.' });

  const { data: mediaId, error: accessError } = await asCaller.rpc('prepare_patient_whatsapp_audio', { p_message_id: messageId });
  if (accessError || !mediaId) return reply(403, { error: accessError?.message ?? 'Áudio não disponível.' });
  const fail = async (status: number, error: string) => {
    await admin.rpc('fail_patient_whatsapp_audio', { p_message_id: messageId });
    return reply(status, { error });
  };

  try {
    const metadata = await fetch(`${config.apiUrl}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${config.token}` }
    });
    if (!metadata.ok) return fail(502, 'Não foi possível localizar o áudio no WhatsApp.');
    const details = await metadata.json() as { url?: string; mime_type?: string; file_size?: number };
    const mediaUrl = details.url ? new URL(details.url) : null;
    if (!mediaUrl || mediaUrl.protocol !== 'https:' || !/(\.facebook\.com|\.whatsapp\.net|\.fbsbx\.com)$/.test(mediaUrl.hostname))
      return fail(502, 'Endereço do áudio inválido.');
    const mime = (details.mime_type ?? 'audio/ogg').split(';')[0].trim().toLowerCase();
    const extension = EXTENSIONS[mime];
    if (!extension) return fail(415, 'Formato de áudio não suportado para transcrição.');
    if ((details.file_size ?? 0) > MAX_BYTES) return fail(413, 'O áudio excede 25 MB.');

    const download = await fetch(mediaUrl, { headers: { Authorization: `Bearer ${config.token}` } });
    if (!download.ok) return fail(502, 'Não foi possível baixar o áudio.');
    // Sem tamanho informado pela Meta, confere o cabeçalho antes de carregar o arquivo inteiro.
    if (Number(download.headers.get('content-length') ?? 0) > MAX_BYTES) return fail(413, 'O áudio excede 25 MB.');
    const bytes = await download.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return fail(413, 'O áudio está vazio ou excede 25 MB.');

    const model = Deno.env.get('TRANSCRIBE_MODEL') ?? 'gpt-4o-mini-transcribe';
    const form = new FormData();
    form.append('model', model);
    form.append('language', 'pt');
    form.append('file', new Blob([bytes], { type: mime }), `mensagem.${extension}`);
    const transcription = await fetch(Deno.env.get('OPENAI_API_URL') ?? 'https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form
    });
    if (!transcription.ok) {
      console.error('transcrição', transcription.status, (await transcription.text()).slice(0, 300));
      return fail(502, 'Não foi possível transcrever o áudio. Tente novamente.');
    }
    const result = await transcription.json() as { text?: string; usage?: { type?: string; seconds?: number } };
    const transcript = result.text?.trim() ?? '';
    if (!transcript || transcript.length > 12000) return fail(422, 'A transcrição está vazia ou longa demais.');

    // Duração informada pela API; sem ela, estimativa pelo tamanho (áudio de voz do WhatsApp ≈ 16 kbit/s).
    const seconds = result.usage?.seconds ?? Math.round(bytes.byteLength / 2000);
    const perMinute = Number(Deno.env.get('TRANSCRIBE_USD_PER_MINUTE') ?? '0.006');
    const cost = Math.round((seconds / 60) * perMinute * 10000) / 10000;
    const { error: saveError } = await admin.rpc('finish_patient_whatsapp_audio', {
      p_message_id: messageId, p_transcript: transcript, p_model: model, p_seconds: seconds, p_cost_usd: cost
    });
    if (saveError) return fail(500, 'Não foi possível guardar a transcrição.');
    return reply(200, { text: transcript });
  } catch (error) {
    console.error(error);
    return fail(502, 'Não foi possível processar o áudio.');
  }
});
