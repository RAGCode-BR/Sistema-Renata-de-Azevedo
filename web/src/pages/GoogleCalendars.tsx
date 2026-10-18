import { useEffect, useState } from 'react';
import { can } from '../../../shared/permissions.ts';
import type { GoogleCalendar, SessionUser } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { ConfirmModal } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { dateTime, plural } from '../format.ts';
import { errorMessage, useLoad } from '../hooks.ts';

const RESULT: Record<string, string> = {
  conectado: 'Conta Google conectada. As próximas sessões serão enviadas em instantes.',
  cancelado: 'Conexão cancelada no Google.',
  invalido: 'O pedido de conexão expirou ou é inválido. Tente de novo.',
  'sem-token': 'O Google não liberou o acesso contínuo. Tente de novo e aceite todas as permissões.',
  'sem-permissao': 'Só profissionais com conta ativa conectam a agenda.',
  'nao-configurado': 'A integração com o Google ainda não foi configurada pela administração.',
  erro: 'Não foi possível concluir a conexão com o Google.'
};
const ROLE: Record<string, string> = { owner: 'proprietária', writer: 'edição', reader: 'leitura', freeBusyReader: 'só livre/ocupado' };

// Google Agenda. A profissional conecta a própria conta, escolhe para qual calendário as sessões vão
// (com Meet nas on-line) e quais calendários informam horários ocupados. Quem vê a agenda geral
// acompanha as conexões de todas, sem alterar.
export function GoogleCalendarsPage({ user, result }: { user: SessionUser; result: string | null }) {
  const notify = useToast();
  const professional = user.roles.includes('professional') && Boolean(user.professional_id);
  const { data, error, reload } = useLoad(() => Promise.all([api.googleCalendars(), api.googleSyncStatus().catch(() => null)]), []);
  const [busy, setBusy] = useState('');
  const [disconnecting, setDisconnecting] = useState<{ id: string; email: string } | null>(null);
  const [notice, setNotice] = useState(result ? RESULT[result] ?? '' : '');
  const [calendars, status] = data ?? [[], null];
  const mine = calendars.filter((item) => item.can_edit);
  const others = calendars.filter((item) => !item.can_edit);
  const accounts = [...new Map(mine.map((item) => [item.google_account_id, item.google_email])).entries()];

  useEffect(() => {
    if (result && window.location.hash.includes('google=')) history.replaceState(null, '', '#/google-agenda');
  }, [result]);

  async function run(key: string, action: () => Promise<unknown>, done?: string) {
    setBusy(key);
    try {
      await action();
      if (done) notify(done);
      reload();
    } catch (failure) {
      notify(errorMessage(failure));
    } finally {
      setBusy('');
    }
  }

  async function connect() {
    setBusy('connect');
    try {
      window.location.assign(await api.googleConnectUrl());
    } catch (failure) {
      setNotice(errorMessage(failure));
      setBusy('');
    }
  }

  return (
    <>
      <Heading title="Google Agenda" lead="As sessões vão para o seu Google Agenda (com Google Meet nas on-line) e seus compromissos pessoais aparecem como ocupado na agenda da clínica.">
        {calendars.length > 0 && (
          <button type="button" className="button light" disabled={busy !== ''} onClick={() => run('sync', async () => {
            const done = await api.googleSyncNow();
            notify(`Sincronizado: ${plural(done.pushed, 'sessão enviada', 'sessões enviadas')}${done.failed ? `, ${done.failed} com erro` : ''}.`);
          })}>{busy === 'sync' ? 'Sincronizando…' : 'Sincronizar agora'}</button>
        )}
        {professional && <button type="button" className="button" disabled={busy !== ''} onClick={connect}>
          {busy === 'connect' ? 'Abrindo o Google…' : accounts.length ? 'Conectar outra conta' : 'Conectar minha conta Google'}</button>}
      </Heading>

      {notice && <p className="notice" role="status">{notice}</p>}
      {status && (status.pending > 0 || status.failing > 0 || status.last_error) && (
        <p className="notice" role="status">
          {status.pending > 0 && `${plural(status.pending, 'alteração aguardando', 'alterações aguardando')} envio ao Google. `}
          {status.failing > 0 && `${plural(status.failing, 'alteração não pôde', 'alterações não puderam')} ser enviada(s) depois de 5 tentativas. `}
          {status.last_error && `Último erro: ${status.last_error}`}
        </p>
      )}

      {professional && (
        <Panel title="Meus calendários" tools={status?.last_run_at ? <span className="muted small">Última sincronização: {dateTime(status.last_run_at)}</span> : undefined}>
          {mine.length ? <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Calendário</th><th>Conta</th><th>Mostrar ocupado</th><th>Enviar as sessões para cá</th></tr></thead>
                <tbody>
                  {mine.map((item) => (
                    <tr key={item.id}>
                      <td>{item.display_name}<span className="sub">Acesso: {ROLE[item.access_role]}</span></td>
                      <td>{item.google_email}</td>
                      <td><label className="check"><input type="checkbox" checked={item.selected} disabled={busy !== ''}
                        aria-label={`Mostrar ocupado de ${item.display_name}`}
                        onChange={(event) => run(item.id, () => api.setGoogleCalendar(item.id, event.target.checked, item.push_target))} /></label></td>
                      <td>{['owner', 'writer'].includes(item.access_role)
                        ? <label className="check"><input type="radio" name="push-target" checked={item.push_target} disabled={busy !== ''}
                            aria-label={`Enviar sessões para ${item.display_name}`}
                            onChange={() => run(item.id, () => api.setGoogleCalendar(item.id, item.selected, true), 'As sessões futuras serão enviadas para este calendário.')} /></label>
                        : <span className="muted small">só leitura</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel-body stack">
              {accounts.map(([id, email]) => (
                <p key={id} className="muted small">{email} · <button type="button" className="link-btn danger" onClick={() => setDisconnecting({ id, email })}>Desconectar</button></p>
              ))}
              <p className="muted small">O título dos eventos segue a configuração da clínica (padrão: só as iniciais do paciente). Mudanças feitas no Google não alteram a agenda da clínica.</p>
            </div>
          </> : <PanelState error={error} loading={!data} empty="Nenhuma conta Google conectada. Use “Conectar minha conta Google”." />}
        </Panel>
      )}

      {can(user, 'calendars.view_all') && (
        <Panel title="Conexões da equipe">
          {others.length || (!professional && mine.length) ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Profissional</th><th>Conta Google</th><th>Calendário</th><th>Uso</th><th>Sincronizado</th></tr></thead>
                <tbody>
                  {(professional ? others : calendars).map((item: GoogleCalendar) => (
                    <tr key={item.id}>
                      <td>{item.professional_name}</td>
                      <td>{item.google_email}</td>
                      <td>{item.display_name}</td>
                      <td>{[item.push_target && 'recebe as sessões', item.selected && 'informa ocupado'].filter(Boolean).join(', ') || '—'}</td>
                      <td>{dateTime(item.last_synced_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <PanelState error={error} loading={!data} empty="Nenhuma profissional conectou o Google ainda." />}
        </Panel>
      )}

      {disconnecting && (
        <ConfirmModal title="Desconectar conta Google" confirmLabel="Desconectar" onClose={() => setDisconnecting(null)}
          onConfirm={async () => {
            const done = await api.googleDisconnect(disconnecting.id);
            notify(`Conta desconectada; ${plural(done.removedEvents, 'evento removido', 'eventos removidos')} do Google.`);
            reload();
          }}>
          <p className="modal-text">{disconnecting.email}: os eventos de sessões criados pelo sistema saem do Google e a autorização é revogada. A agenda da clínica não muda.</p>
        </ConfirmModal>
      )}
    </>
  );
}
