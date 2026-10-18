// Assistente de documentação clínica (Claude, Anthropic). Só a profissional responsável, com os três
// consentimentos (clínica, profissional, paciente) e dentro do limite mensal — conferidos no banco
// (ai_prepare_run, com o token dela). O texto vai com dados pessoais ocultos; a resposta volta em formato
// fixo, é conferida (trecho de origem obrigatório; sem diagnóstico/prescrição) e fica como RASCUNHO.
// Segredos: ANTHROPIC_API_KEY. AI_MODEL (padrão claude-opus-5-5) e ANTHROPIC_BASE_URL só se for preciso mudar.
import Anthropic from 'npm:@anthropic-ai/sdk';
import { reply, serveUser, UUID } from '../_shared/admin.ts';
import { SCHEMA, SYSTEM, check, costUsd, redact } from '../_shared/ai.ts';

const MODEL = Deno.env.get('AI_MODEL') ?? 'claude-opus-5-5';

serveUser(async ({ admin, asCaller, input }) => {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return reply(503, { error: 'O assistente de IA ainda não foi configurado pela administração.', code: 'not_configured' });
  const transcriptId = typeof input.transcriptId === 'string' ? input.transcriptId : '';
  if (!UUID.test(transcriptId)) return reply(400, { error: 'Transcrição inválida.' });

  const { data: prepared, error } = await asCaller.rpc('ai_prepare_run', { p_transcript_id: transcriptId });
  if (error || !prepared) return reply(403, { error: error?.message ?? 'Não foi possível usar o assistente.' });
  const runId: string = prepared.run_id;
  const redacted = redact(prepared.text as string, prepared.names ?? [], prepared.contacts ?? []);
  const finish = (fields: Record<string, unknown>) => admin.rpc('ai_finish_run', {
    p_run_id: runId, p_model: null, p_redacted_text: null, p_result: null, p_warnings: [], p_error: null,
    p_input_tokens: null, p_output_tokens: null, p_cost_usd: 0, ...fields
  });

  try {
    const client = new Anthropic({ apiKey, baseURL: Deno.env.get('ANTHROPIC_BASE_URL') || undefined });
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: `Transcrição da sessão (dados pessoais ocultos):\n<transcricao>\n${redacted}\n</transcricao>` }]
    });
    const usage = response.usage;
    const cost = costUsd(response.model, usage.input_tokens, usage.output_tokens, usage.cache_read_input_tokens ?? 0, usage.cache_creation_input_tokens ?? 0);
    const metering = { p_model: response.model, p_input_tokens: usage.input_tokens, p_output_tokens: usage.output_tokens, p_cost_usd: cost };

    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      const message = response.stop_reason === 'refusal' ? 'O modelo recusou processar esta transcrição.' : 'A resposta ficou longa demais; tente uma transcrição menor.';
      await finish({ ...metering, p_status: 'failed', p_error: message });
      return reply(422, { error: message, runId });
    }
    const text = response.content.find((block) => block.type === 'text');
    const raw = text && text.type === 'text' ? JSON.parse(text.text) : null;
    const { draft, warnings } = check(raw, redacted);
    await finish({ ...metering, p_status: 'done', p_redacted_text: redacted, p_result: draft, p_warnings: warnings });
    return reply(200, { runId });
  } catch (failure) {
    console.error(failure);
    const message = failure instanceof Anthropic.APIError ? `Serviço de IA indisponível (${failure.status ?? 'erro'}).` : 'Não foi possível gerar o rascunho.';
    await finish({ p_status: 'failed', p_error: message });
    return reply(502, { error: message, runId });
  }
});
