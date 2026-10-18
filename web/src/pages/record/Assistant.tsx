import { useState } from 'react';
import type { ReactNode } from 'react';
import type { AiDraft, AiItem, AiRun, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal, Modal } from '../../components/Modal.tsx';
import { Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dateTime, longDay, time } from '../../format.ts';
import { errorMessage, text, useLoad } from '../../hooks.ts';

// Assistente de documentação com IA. Só funciona com a IA ligada na clínica, o termo aceito pela
// profissional e o consentimento do paciente registrado. Gera um RASCUNHO: a profissional escolhe os
// itens, edita o texto e decide; o rascunho vai para Evoluções e só vale quando ela finalizar.

const SECTIONS: [keyof AiDraft['evolution'], string][] = [
  ['themes', 'Temas trabalhados'], ['interventions', 'Intervenções realizadas'],
  ['observations', 'Observações relevantes'], ['agreements', 'Combinados e próximos passos']
];

export const TERMS = `Termo de uso do assistente de documentação com IA (versão v1)

1. O assistente prepara rascunhos a partir de transcrições autorizadas. Ele pode errar: todo conteúdo precisa ser conferido por mim antes de entrar no prontuário.
2. Só envio transcrições de pacientes que deram consentimento específico, registrado no sistema.
3. Não uso o assistente para diagnóstico, prescrição ou decisões clínicas; o julgamento clínico é meu.
4. Antes do envio, o sistema oculta nome, CPF, telefone, e-mail e endereço. Informo outros nomes (cônjuge, familiares) no campo próprio quando aparecerem.
5. A transcrição é apagada automaticamente depois do prazo configurado pela clínica.`;

export const CONSENT_MODEL = `MODELO — TERMO DE CONSENTIMENTO PARA USO DE TRANSCRIÇÃO E INTELIGÊNCIA ARTIFICIAL NA DOCUMENTAÇÃO
(rascunho para revisão jurídica; não utilizar antes dessa revisão)

Eu, ______________________________, autorizo que a transcrição das minhas sessões com a profissional ______________________________ seja usada, com meus dados de identificação ocultos, por um serviço de inteligência artificial contratado pela clínica (Anthropic, com processamento fora do Brasil), exclusivamente para preparar rascunhos de registro que serão revisados pela profissional.
Fui informado(a) de que: a IA não faz diagnóstico nem define tratamento; nada entra no meu prontuário sem a revisão da profissional; a transcrição é apagada após o prazo definido pela clínica; posso revogar esta autorização a qualquer momento, sem prejuízo do atendimento.

Local e data: ____________________    Assinatura: ______________________________`;

// .vtt/.srt exportados do Meet ou do tl;dv: tira numeração e horários, mantém as falas.
function cleanTranscript(raw: string): string {
  return raw.replace(/^WEBVTT.*$/m, '').split(/\r?\n/)
    .filter((line) => !/^\d+$/.test(line.trim()) && !/-->/.test(line) && !/^(NOTE|STYLE)\b/.test(line.trim()))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function Assistant({ user, patientId, onUsed }: { user: SessionUser; patientId: string; onUsed: () => void }) {
  const notify = useToast();
  const status = useLoad(() => Promise.all([api.aiStatus(patientId), api.aiRuns(patientId), api.patientAppointments(patientId)]), [patientId]);
  const [dialog, setDialog] = useState<'terms' | 'consent' | 'revoke' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);

  if (!status.data) return <PanelState error={status.error} loading={!status.error} empty="" />;
  const [state, runs, appointments] = status.data;
  const sessions = appointments.filter((item) => item.professional_id === user.professional_id && item.status === 'completed').slice(0, 30);

  async function generate(form: FormData) {
    setBusy(true);
    try {
      const transcriptId = await api.createAiTranscript({
        patientId, appointmentId: text(form, 'session') || null, source: fileName ? 'file' : 'paste', fileName, content,
        extraTerms: text(form, 'extra').split(',').map((item) => item.trim()).filter(Boolean)
      });
      const runId = await api.aiGenerate(transcriptId);
      setContent(''); setFileName(null);
      status.reload();
      setOpen(runId);
    } catch (failure) {
      notify(errorMessage(failure));
      status.reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Assistente de documentação (IA)">
        <div className="panel-body stack">
          <p className="muted small">A IA prepara um rascunho a partir da transcrição autorizada. Ela pode errar e não faz diagnóstico nem prescrição: tudo é conferido por você, e nada entra no prontuário sem a sua finalização.</p>
          <ul className="ai-checks">
            <li className={state.clinic_enabled ? 'ok' : ''}>{state.clinic_enabled ? 'IA ligada na clínica' : 'IA desligada na clínica (Configurações, pela Proprietária)'}</li>
            <li className={state.terms_accepted ? 'ok' : ''}>{state.terms_accepted ? 'Termo de uso aceito por você'
              : <>Termo de uso não aceito · <button type="button" className="link-btn" onClick={() => setDialog('terms')}>Ler e aceitar</button></>}</li>
            <li className={state.consent_at ? 'ok' : ''}>{state.consent_at
              ? <>Consentimento do paciente registrado em {dateTime(state.consent_at)} · <button type="button" className="link-btn danger" onClick={() => setDialog('revoke')}>Revogar</button></>
              : <>Sem consentimento do paciente · <button type="button" className="link-btn" onClick={() => setDialog('consent')}>Registrar consentimento</button></>}</li>
            {state.limit_reached && <li>Limite mensal de custo atingido; volta no próximo mês.</li>}
          </ul>

          {!state.blocker && (
            <form className="form-grid ai-form" onSubmit={(event) => { event.preventDefault(); if (content.trim()) generate(new FormData(event.currentTarget)); }}>
              <Field label="Sessão (opcional)">
                <select className="input" name="session" defaultValue="">
                  <option value="">Sem sessão</option>
                  {sessions.map((item) => <option key={item.id} value={item.id}>{longDay(item.starts_at)}, {time(item.starts_at)}</option>)}
                </select>
              </Field>
              <Field label="Arquivo da transcrição (.txt, .vtt, .srt)">
                <input className="input" type="file" accept=".txt,.vtt,.srt,text/plain,text/vtt" onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 2_000_000) { notify('Arquivo grande demais (máximo de 2 MB).'); return; }
                  setContent(cleanTranscript(await file.text())); setFileName(file.name);
                }} />
              </Field>
              <Field label="Transcrição" full>
                <textarea className="input" rows={8} value={content} onChange={(event) => { setContent(event.target.value); setFileName(null); }}
                  placeholder="Cole aqui a transcrição exportada do tl;dv ou do Google Meet" aria-label="Transcrição" />
              </Field>
              <Field label="Outros nomes para ocultar (separados por vírgula)" full>
                <input className="input" name="extra" placeholder="Ex.: nome do cônjuge, dos filhos, do local de trabalho" />
              </Field>
              <p className="muted small full">Nome, CPF, telefone, e-mail e endereço do paciente e do responsável são ocultados automaticamente antes do envio.</p>
              <div className="full"><button type="submit" className="button" disabled={busy || content.trim().length < 50}>{busy ? 'Gerando rascunho…' : 'Gerar rascunho'}</button></div>
            </form>
          )}
          {state.blocker && <p className="notice">{state.blocker}</p>}
        </div>
      </Panel>

      {runs.length > 0 && (
        <Panel title="Rascunhos de IA deste paciente">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Gerado em</th><th>Situação</th><th className="num">Custo</th><th><span className="sr-only">Abrir</span></th></tr></thead>
              <tbody>{runs.map((item) => (
                <tr key={item.id}>
                  <td>{dateTime(item.created_at)}</td>
                  <td>{item.status === 'failed' ? 'Falhou' : item.status === 'pending' ? 'Em processamento' : item.decision === 'used' ? 'Usado em evolução'
                    : item.decision === 'discarded' ? 'Descartado' : 'Aguardando revisão'}{!item.available && item.status === 'done' ? ' (conteúdo apagado)' : ''}</td>
                  <td className="num">US$ {Number(item.cost_usd).toFixed(4).replace('.', ',')}</td>
                  <td className="actions-cell">{(item.available || item.status === 'failed') && <button type="button" className="link-btn" onClick={() => setOpen(item.id)}>Abrir</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Panel>
      )}

      {dialog === 'terms' && (
        <FormModal title="Termo de uso do assistente" submitLabel="Li e aceito" onClose={() => setDialog(null)} onSubmit={async () => {
          await api.acceptAiTerms(); notify('Termo aceito.'); status.reload();
        }}>
          <p className="pre full terms-text">{TERMS}</p>
        </FormModal>
      )}
      {dialog === 'consent' && (
        <FormModal title="Consentimento do paciente" submitLabel="Registrar consentimento" onClose={() => setDialog(null)} onSubmit={async (form) => {
          if (form.get('confirm') !== 'on') throw new Error('Confirme que o paciente assinou o termo.');
          await api.setAiConsent(patientId, true, text(form, 'notes')); notify('Consentimento registrado.'); status.reload();
        }}>
          <details className="full templates"><summary>Modelo de termo (rascunho para revisão jurídica)</summary><p className="pre terms-text">{CONSENT_MODEL}</p></details>
          <Field label="Observação (ex.: onde está o termo assinado)" full><input className="input" name="notes" maxLength={1000} /></Field>
          <label className="check full"><input type="checkbox" name="confirm" /><span>O paciente leu e assinou o termo de consentimento específico para o uso de IA.</span></label>
        </FormModal>
      )}
      {dialog === 'revoke' && (
        <FormModal title="Revogar consentimento" submitLabel="Revogar" onClose={() => setDialog(null)} onSubmit={async () => {
          await api.setAiConsent(patientId, false); notify('Consentimento revogado; transcrições e rascunhos guardados foram apagados.'); status.reload();
        }}>
          <p className="modal-text full">A IA deixa de poder ser usada para este paciente e o que estiver guardado (transcrições e rascunhos não usados) é apagado. Evoluções já finalizadas continuam no prontuário.</p>
        </FormModal>
      )}
      {open && <Review user={user} patientId={patientId} runId={open} onClose={() => setOpen(null)} onChanged={status.reload} onUsed={onUsed} />}
    </>
  );
}

function Review({ user, patientId, runId, onClose, onChanged, onUsed }: {
  user: SessionUser; patientId: string; runId: string; onClose: () => void; onChanged: () => void; onUsed: () => void;
}) {
  const notify = useToast();
  const { data, error } = useLoad(() => api.aiRun(runId), [runId]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [focus, setFocus] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (!data) return <Modal title="Rascunho de IA" onClose={onClose}><div className="modal-body"><PanelState error={error} loading={!error} empty="" /></div></Modal>;
  const run: AiRun = data;
  const draft = run.result;
  if (!draft) {
    return (
      <Modal title="Rascunho de IA" onClose={onClose}>
        <div className="modal-body"><p className="notice">{run.error ?? 'O conteúdo deste rascunho já foi apagado.'}</p></div>
      </Modal>
    );
  }
  const keyOf = (section: string, index: number) => `${section}:${index}`;
  const all = new Set(SECTIONS.flatMap(([section]) => draft.evolution[section].map((_, index) => keyOf(section, index))));
  const chosen = picked ?? all;
  const compose = (selection: Set<string>) => SECTIONS
    .map(([section, label]) => [label, draft.evolution[section].filter((_, index) => selection.has(keyOf(section, index)))] as const)
    .filter(([, items]) => items.length)
    .map(([label, items]) => `${label}:\n${items.map((item) => `- ${item.text}`).join('\n')}`).join('\n\n');
  const text = body ?? compose(chosen);
  const decided = run.decision !== null;

  function toggle(key: string) {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key); else next.add(key);
    setPicked(next);
    setBody(compose(next));
  }

  async function act(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action(); notify(done); onChanged(); onClose();
    } catch (failure) {
      notify(errorMessage(failure)); setBusy(false);
    }
  }

  const Item = ({ item, id, selectable }: { item: AiItem; id?: string; selectable?: boolean }) => (
    <li className="ai-item">
      {selectable && id && <input type="checkbox" checked={chosen.has(id)} disabled={decided} aria-label={`Incluir: ${item.text}`} onChange={() => toggle(id)} />}
      <span>{item.text}
        <button type="button" className="link-btn ai-source" onClick={() => setFocus(item.evidence)}>ver trecho</button>
      </span>
    </li>
  );

  return (
    <Modal title="Revisar rascunho de IA" onClose={onClose}>
      <div className="modal-body ai-review">
        <div className="ai-columns">
          <section aria-label="Rascunho">
            {run.warnings.length > 0 && <div className="notice small">{run.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>}
            {draft.summary && <><h3 className="task-section">Resumo</h3><ul className="ai-list"><Item item={draft.summary} /></ul></>}
            {draft.topics.length > 0 && <><h3 className="task-section">Tópicos importantes</h3><ul className="ai-list">{draft.topics.map((item, index) => <Item key={index} item={item} />)}</ul></>}
            <h3 className="task-section">Evolução (marque o que entra)</h3>
            {SECTIONS.map(([section, label]) => draft.evolution[section].length > 0 && (
              <div key={section}><p className="ai-label">{label}</p>
                <ul className="ai-list">{draft.evolution[section].map((item, index) => <Item key={index} item={item} id={keyOf(section, index)} selectable />)}</ul></div>
            ))}
            {draft.gaps.length > 0 && <><h3 className="task-section">Para você completar</h3><ul className="ai-list plain">{draft.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></>}
            {draft.admin_tasks.length > 0 && <><h3 className="task-section">Tarefas administrativas sugeridas</h3>
              <ul className="ai-list">{draft.admin_tasks.map((item, index) => (
                <li key={index} className="ai-item"><span>{item.text}
                  <button type="button" className="link-btn ai-source" onClick={async () => {
                    try {
                      await api.saveTask(null, { title: item.text.slice(0, 200), description: '', assigneeId: user.id, priority: 'normal', dueDate: null, dueTime: null, patientId });
                      notify('Tarefa criada em Minhas tarefas.');
                    } catch (failure) { notify(errorMessage(failure)); }
                  }}>criar tarefa</button></span></li>
              ))}</ul></>}
          </section>
          <section aria-label="Transcrição com dados ocultos" className="ai-transcript">
            <h3 className="task-section">Transcrição (dados pessoais ocultos)</h3>
            <div className="pre ai-transcript-text">{highlight(run.redacted_text ?? '', focus)}</div>
          </section>
        </div>
        <Field label="Texto que vai para o rascunho de evolução (edite à vontade)" full>
          <textarea className="input" rows={8} value={text} disabled={decided} onChange={(event) => setBody(event.target.value)} />
        </Field>
        <p className="muted small">Gerado por {run.model ?? 'IA'} em {dateTime(run.created_at)}. O texto entra como rascunho em Evoluções; ele só passa a valer quando você finalizar.</p>
      </div>
      {!decided && (
        <div className="modal-foot">
          <button type="button" className="button light" disabled={busy} onClick={() => act(() => api.aiDiscard(run.id), 'Rascunho descartado.')}>Descartar</button>
          <button type="button" className="button" disabled={busy || !text.trim()} onClick={() => act(async () => { await api.aiUseDraft(run.id, text); onUsed(); },
            'Rascunho de evolução criado. Revise e finalize em Evoluções.')}>Usar como rascunho de evolução</button>
        </div>
      )}
    </Modal>
  );
}

// Destaca na transcrição os trechos de origem do item escolhido.
function highlight(source: string, quotes: string[]) {
  if (!quotes.length) return source;
  const lower = source.toLowerCase();
  const marks: [number, number][] = [];
  for (const quote of quotes) {
    const at = lower.indexOf(quote.toLowerCase().trim());
    if (at >= 0) marks.push([at, at + quote.trim().length]);
  }
  marks.sort((a, b) => a[0] - b[0]);
  const parts: ReactNode[] = [];
  let cursor = 0;
  marks.forEach(([start, end], index) => {
    if (start < cursor) return;
    parts.push(source.slice(cursor, start), <mark key={index}>{source.slice(start, end)}</mark>);
    cursor = end;
  });
  parts.push(source.slice(cursor));
  return parts;
}
