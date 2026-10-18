// Assistente de documentação clínica: ocultação de dados, instruções, formato da resposta e conferência.
// Regras do documento da clínica: não inventar, não diagnosticar, não prescrever, não publicar sozinho.

const strip = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PARTICLES = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

// Troca nome (e partes do nome), nomes extras, CPF, telefones, e-mails, endereço e CEP por marcadores.
export function redact(text: string, names: string[], contacts: string[]): string {
  let out = text;
  for (const contact of contacts.filter((item) => item && item.trim().length >= 6)) {
    out = out.replace(new RegExp(escape(contact.trim()), 'gi'), '[DADO PESSOAL]');
  }
  out = out
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[E-MAIL]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/\b\d{5}-?\d{3}\b/g, '[CEP]')
    .replace(/(\+?55\s?)?(\(?\d{2}\)?\s?)?9?\d{4}[-\s]?\d{4}\b/g, '[TELEFONE]');
  const parts = new Set<string>();
  for (const name of names.filter(Boolean)) {
    parts.add(name.trim());
    for (const part of name.split(/\s+/)) if (part.length >= 3 && !PARTICLES.has(part.toLowerCase())) parts.add(part);
  }
  // Nomes mais longos primeiro ("Maria Silva" antes de "Maria"); sem diferenciar acentos e maiúsculas.
  for (const part of [...parts].sort((a, b) => b.length - a.length)) {
    out = out.normalize('NFD').replace(new RegExp(`(?<![\\p{L}\\p{N}])${accentless(part)}(?![\\p{L}\\p{N}])`, 'giu'), '[NOME]').normalize('NFC');
  }
  return out;
}

// Expressão que casa a palavra com ou sem acentos (texto em NFD).
function accentless(word: string): string {
  return strip(word).split('').map((c) => (/\p{L}/u.test(c) ? `${escape(c)}\\p{M}*` : escape(c))).join('');
}

export const SYSTEM = `Você ajuda psicólogas a documentar sessões a partir da transcrição autorizada de um atendimento.
Você prepara um RASCUNHO para a profissional revisar; ela decide o que vai ao prontuário.

Regras obrigatórias:
- Use só o que está na transcrição. Não invente, não complete lacunas e não presuma fatos.
- Cada item precisa de pelo menos um trecho de apoio copiado literalmente da transcrição (campo "evidence"), curto (até 30 palavras).
- Não sugira, confirme nem nomeie diagnósticos, transtornos, CID ou hipóteses diagnósticas.
- Não prescreva nem sugira tratamentos, medicamentos, doses ou condutas clínicas.
- Não faça julgamentos clínicos; descreva o que foi dito e feito na sessão, em linguagem objetiva.
- Os marcadores [NOME], [CPF], [TELEFONE], [E-MAIL], [CEP] e [DADO PESSOAL] substituem dados pessoais: mantenha-os como estão.
- "admin_tasks" são só tarefas administrativas mencionadas (enviar recibo, remarcar, enviar documento), sem conteúdo clínico.
- Em "gaps", liste o que a profissional precisa completar porque a transcrição não permite afirmar.
- Escreva em português do Brasil.`;

const ITEM = {
  type: 'object', additionalProperties: false, required: ['text', 'evidence'],
  properties: { text: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } }
};
export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'topics', 'evolution', 'admin_tasks', 'gaps'],
  properties: {
    summary: ITEM,
    topics: { type: 'array', items: ITEM },
    evolution: {
      type: 'object', additionalProperties: false, required: ['themes', 'interventions', 'observations', 'agreements'],
      properties: {
        themes: { type: 'array', items: ITEM }, interventions: { type: 'array', items: ITEM },
        observations: { type: 'array', items: ITEM }, agreements: { type: 'array', items: ITEM }
      }
    },
    admin_tasks: { type: 'array', items: ITEM },
    gaps: { type: 'array', items: { type: 'string' } }
  }
};

export interface Item { text: string; evidence: string[] }
export interface Draft {
  summary: Item | null; topics: Item[];
  evolution: { themes: Item[]; interventions: Item[]; observations: Item[]; agreements: Item[] };
  admin_tasks: Item[]; gaps: string[];
}

// Termos que indicam diagnóstico ou prescrição no texto produzido pela IA (não nos trechos citados).
const FORBIDDEN = [
  /\b[FZ]\d{2}(\.\d+)?\b/, /\bcid\b/i, /diagn[oó]stic/i, /\btranstorno/i, /\bhip[oó]tese diagn/i,
  /prescrev/i, /\bmedica(ç|c)(ã|a)o\b/i, /\bmedicamento/i, /\b\d+\s?mg\b/i, /\bdose\b/i, /\bposologia/i
];
const comparable = (text: string) => strip(text).toLowerCase().replace(/[“”"'‘’«»]/g, '').replace(/\s+/g, ' ').trim();

// Mantém só itens com apoio literal na transcrição e sem diagnóstico/prescrição; o resto vira aviso.
export function check(raw: unknown, transcript: string): { draft: Draft; warnings: string[] } {
  const source = comparable(transcript);
  const warnings: string[] = [];
  const keep = (item: unknown, where: string): Item | null => {
    const value = item as Partial<Item> | null;
    if (!value || typeof value.text !== 'string' || !value.text.trim()) return null;
    if (FORBIDDEN.some((pattern) => pattern.test(value.text!))) {
      warnings.push(`${where}: item removido por parecer diagnóstico ou prescrição.`);
      return null;
    }
    const evidence = (Array.isArray(value.evidence) ? value.evidence : [])
      .filter((quote): quote is string => typeof quote === 'string' && comparable(quote).length >= 6 && source.includes(comparable(quote)));
    if (!evidence.length) {
      warnings.push(`${where}: item removido por não ter trecho correspondente na transcrição.`);
      return null;
    }
    return { text: value.text.trim(), evidence };
  };
  const list = (items: unknown, where: string) => (Array.isArray(items) ? items : []).map((item) => keep(item, where)).filter((item): item is Item => item !== null);
  const data = (raw ?? {}) as Record<string, unknown>;
  const evolution = (data.evolution ?? {}) as Record<string, unknown>;
  return {
    draft: {
      summary: keep(data.summary, 'Resumo'),
      topics: list(data.topics, 'Tópicos'),
      evolution: {
        themes: list(evolution.themes, 'Temas trabalhados'), interventions: list(evolution.interventions, 'Intervenções'),
        observations: list(evolution.observations, 'Observações'), agreements: list(evolution.agreements, 'Combinados')
      },
      admin_tasks: list(data.admin_tasks, 'Tarefas'),
      gaps: (Array.isArray(data.gaps) ? data.gaps : []).filter((gap): gap is string => typeof gap === 'string' && !FORBIDDEN.some((p) => p.test(gap))).slice(0, 20)
    },
    warnings
  };
}

// Preço por milhão de tokens (US$), da tabela oficial em 06/10/2026. Confira em https://www.anthropic.com/pricing.
const PRICES: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20], 'claude-opus-4-8': [5, 25], 'claude-opus-5': [5, 25], 'claude-sonnet-5-5': [2, 10]
};
export function costUsd(model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0): number {
  const [inPrice, outPrice] = PRICES[model] ?? [5, 25];
  return Math.round(((input + cacheWrite * 1.25 + cacheRead * 0.1) * inPrice + output * outPrice) / 1e6 * 10000) / 10000;
}
