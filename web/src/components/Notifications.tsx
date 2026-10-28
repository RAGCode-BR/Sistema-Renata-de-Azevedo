import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppNotification } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { dateTime, plural } from '../format.ts';

const REFRESH_MS = 60_000;

// Sino do topo: avisos recebidos. Atualiza a cada minuto e ao trocar de página.
export function NotificationBell({ icon }: { icon: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  async function refresh() {
    try {
      const [list, total] = await Promise.all([api.notifications(), api.unreadNotifications()]);
      setItems(list);
      setUnreadTotal(total);
    } catch { /* o sino fica como estava; a página mostra os erros */ }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener('hashchange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('hashchange', refresh); };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const unread = Math.max(unreadTotal, items.filter((item) => !item.read_at).length);
  const badge = unread;

  async function markAll() {
    await api.markNotificationsRead().catch(() => {});
    refresh();
  }

  async function follow(item: AppNotification) {
    setOpen(false);
    if (!item.read_at) await api.markNotificationsRead([item.id]).catch(() => {});
    if (item.link) {
      const target = item.link.includes('tarefa=')
        ? item.title.includes('Retornar contato') ? '#/comercial' : item.title.includes('remarcar') ? '#/agenda' : '#/pacientes'
        : item.link;
      window.location.hash = target.replace(/^#/, '');
    }
    refresh();
  }

  return (
    <div ref={ref} className="bell">
      <button type="button" className="icon-btn" aria-expanded={open} aria-controls="avisos-menu" onClick={() => { setOpen(!open); if (!open) refresh(); }}
        aria-label={badge ? `Avisos: ${plural(unread, 'novo', 'novos')}` : 'Avisos'}>
        {icon}
        {badge > 0 && <span className="badge" aria-hidden="true">{badge > 99 ? '99+' : badge}</span>}
      </button>
      <div className="pop notifications-pop" id="avisos-menu" hidden={!open}>
        <div className="pop-title bell-head">
          <span>Avisos</span>
          {unread > 0 && <button type="button" className="link-btn" onClick={markAll}>Marcar todos como lidos</button>}
        </div>
        {items.length === 0 && <p className="pop-empty">Nenhum aviso.</p>}
        {items.map((item) => (
          <button key={item.id} type="button" className={item.read_at ? 'pop-item' : 'pop-item unread'} onClick={() => follow(item)}>
            <span>{item.title}<small>{dateTime(item.created_at)}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}
