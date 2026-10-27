import { useEffect, useRef, useState } from 'react';
import type { WhatsappConversation } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { dateTime, relativeDay, time } from '../format.ts';
import { errorMessage, useLoad } from '../hooks.ts';

const STATUS: Record<string, string> = {
  queued: 'na fila', sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'não enviada', received: ''
};
const KIND: Record<string, string> = { confirmation: 'Pedido de confirmação', reminder: 'Lembrete', task: 'Aviso de tarefa', reply: 'Resposta automática', free: '', inbound: '' };
const LINK: Record<string, (id: string) => string> = {
  patient: (id) => `#/pacientes?id=${id}`, lead: (id) => `#/comercial?lead=${id}`
};
const DAY = 86_400_000;
const formatPhone = (phone: string) => phone.replace(/^55(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');

// Conversas do WhatsApp (equipe de atendimento). Resposta livre só até 24 h depois da última mensagem
// da pessoa; fora disso o WhatsApp só aceita modelos aprovados (confirmação, lembrete).
export function ConversationsPage({ phone: initial, canCreatePatientTask = false }: { phone: string | null; canCreatePatientTask?: boolean }) {
  const notify = useToast();
  const list = useLoad(api.whatsappConversations, []);
  const [phone, setPhone] = useState<string | null>(initial);
  const conversations = list.data ?? [];
  const current = conversations.find((item) => item.phone === phone) ?? null;

  useEffect(() => {
    if (!phone && conversations.length && window.matchMedia('(min-width: 861px)').matches) setPhone(conversations[0].phone);
  }, [conversations.length]);

  return (
    <>
      <Heading title="WhatsApp" lead="Mensagens recebidas e enviadas pelo número oficial da clínica." />
      {list.data && !conversations.length && <p className="notice">Nenhuma conversa ainda. Quando o WhatsApp estiver configurado, as mensagens aparecem aqui.</p>}
      {(!list.data || conversations.length > 0) && (
        <div className={phone ? 'chat-layout has-open' : 'chat-layout'}>
          <Panel title="Conversas">
            {list.data ? (
              <ul className="chat-list">
                {conversations.map((item) => (
                  <li key={item.phone}>
                    <button type="button" className={item.phone === phone ? 'chat-item on' : 'chat-item'} aria-current={item.phone === phone ? 'true' : undefined}
                      onClick={() => setPhone(item.phone)}>
                      <span className="chat-name">{item.name}{item.unanswered && <i className="chat-dot" aria-label="aguardando resposta" />}</span>
                      <span className="chat-preview">{item.last_direction === 'out' ? 'Você: ' : ''}{item.last_body}</span>
                      <span className="chat-when">{relativeDay(item.last_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <PanelState error={list.error} loading={!list.error} empty="" />}
          </Panel>
          {current && <Thread conversation={current} onBack={() => setPhone(null)} onChanged={list.reload} notify={notify}
            canCreatePatientTask={canCreatePatientTask} />}
        </div>
      )}
    </>
  );
}

function Thread({ conversation, onBack, onChanged, notify, canCreatePatientTask }: {
  conversation: WhatsappConversation; onBack: () => void; onChanged: () => void; notify: (text: string) => void;
  canCreatePatientTask: boolean;
}) {
  const { data, error, reload } = useLoad(() => api.whatsappMessages(conversation.phone), [conversation.phone, conversation.last_at]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const open = conversation.last_inbound_at !== null && Date.now() - new Date(conversation.last_inbound_at).getTime() < DAY;
  const closesAt = conversation.last_inbound_at ? new Date(new Date(conversation.last_inbound_at).getTime() + DAY) : null;

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [data?.length]);

  async function send() {
    setBusy(true);
    try {
      const delivered = await api.whatsappReply(conversation.phone, text);
      setText('');
      notify(delivered ? 'Mensagem enviada.' : 'Mensagem na fila: o WhatsApp ainda não foi configurado.');
      reload();
      onChanged();
    } catch (failure) {
      notify(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const link = conversation.ref_id && LINK[conversation.kind]?.(conversation.ref_id);
  return (
    <Panel title={conversation.name} tools={<>
      {link && <a className="link-btn" href={link}>{conversation.kind === 'patient' ? 'Abrir paciente' : 'Abrir lead'}</a>}
      <button type="button" className="link-btn chat-back" onClick={onBack}>Voltar</button>
    </>}>
      <p className="muted small panel-note">{formatPhone(conversation.phone)}</p>
      <div className="chat-thread" aria-live="polite">
        {!data && <PanelState error={error} loading={!error} empty="" />}
        {data?.map((item) => (
          <div key={item.id} className={`bubble ${item.direction}`}>
            {KIND[item.kind] && <span className="bubble-kind">{KIND[item.kind]}</span>}
            <p className="pre">{item.body}</p>
            {canCreatePatientTask && conversation.kind === 'patient' && conversation.ref_id && item.direction === 'in' &&
              <a className="link-btn" href={`#/tarefas?paciente=${conversation.ref_id}`}>Criar tarefa para paciente</a>}
            <span className="bubble-meta">{dateTime(item.created_at)}{item.direction === 'out' && STATUS[item.status] ? ` · ${STATUS[item.status]}` : ''}
              {item.status === 'failed' && item.error ? ` (${item.error})` : ''}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form className="chat-compose" onSubmit={(event) => { event.preventDefault(); if (text.trim()) send(); }}>
        <label className="sr-only" htmlFor="chat-text">Mensagem</label>
        <textarea id="chat-text" className="input" rows={2} maxLength={4096} value={text} disabled={!open || busy}
          placeholder={open ? 'Escreva a resposta' : 'Fora da janela de 24 h'} onChange={(event) => setText(event.target.value)} />
        <button type="submit" className="button" disabled={!open || busy || !text.trim()}>{busy ? 'Enviando…' : 'Enviar'}</button>
        <p className="muted small full">
          {open && closesAt ? `Resposta livre até ${relativeDay(closesAt.toISOString())} às ${time(closesAt.toISOString())}. Não envie informações clínicas pelo WhatsApp.`
            : 'O WhatsApp só permite mensagem livre até 24 h depois da última mensagem da pessoa. Fora disso, só confirmações e lembretes automáticos.'}
        </p>
      </form>
    </Panel>
  );
}
