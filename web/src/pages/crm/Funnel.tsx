import { Select } from '../../components/Select.tsx';
import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Lead, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dateKey, daysSince, dayLabel, plural, startOfToday, addDays } from '../../format.ts';
import { errorMessage, useLoad } from '../../hooks.ts';
import { LeadDetail, LeadForm, nameOf, useCrmLists } from './shared.tsx';

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Funil: colunas por etapa (arrastar muda a etapa) ou lista com filtros.
// Convertidos e perdidos mostram só os dos últimos 30 dias, para o quadro não crescer sem fim.
export function FunnelPage({ user, leadId }: { user: SessionUser; leadId: string | null }) {
  const notify = useToast();
  const manage = can(user, 'crm.manage');
  const lists = useCrmLists();
  const { data, error, reload } = useLoad(() => api.leads(), []);
  const [view, setView] = useState<'quadro' | 'lista'>('quadro');
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [source, setSource] = useState('');
  const [open, setOpen] = useState<string | null>(leadId);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);

  if (!lists.data) return <><Heading title="Funil" /><PanelState error={lists.error} loading={!lists.error} empty="" /></>;
  const { stages } = lists.data;
  const recent = dateKey(addDays(startOfToday(), -30));
  const term = normalize(search.trim());
  const digits = search.replace(/\D/g, '');
  const leads = (data ?? []).filter((lead) => !lead.anonymized_at
    && (!term || normalize(lead.name).includes(term) || (digits.length >= 4 && (lead.phone ?? '').replace(/\D/g, '').includes(digits))
      || (lead.email ?? '').includes(term))
    && (!owner || lead.owner_id === owner) && (!source || lead.source_id === source));
  const kindOf = (lead: Lead) => stages.find((stage) => stage.id === lead.stage_id)?.kind ?? 'open';
  const columns = stages.filter((stage) => stage.active || leads.some((lead) => lead.stage_id === stage.id));
  const openCount = leads.filter((lead) => kindOf(lead) === 'open').length;

  async function drop(lead: Lead, stageId: string) {
    setDragging(null);
    const target = stages.find((stage) => stage.id === stageId);
    if (!target || lead.stage_id === stageId) return;
    if (target.kind !== 'open') { setOpen(lead.id); return; }
    try {
      await api.moveLead(lead.id, stageId, null, '');
      reload();
    } catch (failure) {
      notify(errorMessage(failure));
    }
  }

  return (
    <>
      <Heading title="Funil" lead={data ? `${plural(openCount, 'lead em andamento', 'leads em andamento')}.` : undefined}>
        {manage && <button type="button" className="button" onClick={() => setCreating(true)}>Novo lead</button>}
      </Heading>

      <div className="finance-toolbar">
        <div className="tabs" role="tablist" aria-label="Visualização">
          <button type="button" role="tab" aria-selected={view === 'quadro'} className={view === 'quadro' ? 'tab on' : 'tab'} onClick={() => setView('quadro')}>Quadro</button>
          <button type="button" role="tab" aria-selected={view === 'lista'} className={view === 'lista' ? 'tab on' : 'tab'} onClick={() => setView('lista')}>Lista</button>
        </div>
        <label className="field-inline">Responsável
          <Select className="input compact" value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="">Todos</option>
            {lists.data.owners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </label>
        <label className="field-inline">Origem
          <Select className="input compact" value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">Todas</option>
            {lists.data.sources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
        </label>
        <label className="search">
          <input type="search" placeholder="Buscar nome, telefone ou e-mail" aria-label="Buscar lead" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </div>

      {!data ? <PanelState error={error} loading={!error} empty="" /> : view === 'quadro' ? (
        <div className="kanban" aria-label="Funil por etapa">
          {columns.map((stage) => {
            const items = leads.filter((lead) => lead.stage_id === stage.id
              && (stage.kind === 'open' || (lead.converted_at ?? lead.last_activity_at).slice(0, 10) >= recent));
            return (
              <section key={stage.id} className={`kanban-col kind-${stage.kind}${dragging ? ' droppable' : ''}`} aria-label={stage.name}
                onDragOver={(event) => { if (manage) event.preventDefault(); }}
                onDrop={(event) => { const lead = leads.find((item) => item.id === event.dataTransfer.getData('text/plain')); if (lead) drop(lead, stage.id); }}>
                <h2>{stage.name}<small>{items.length}</small></h2>
                {stage.kind !== 'open' && <p className="muted small">Últimos 30 dias</p>}
                {items.map((lead) => (
                  <button key={lead.id} type="button" className="lead-card" draggable={manage && !lead.patient_id}
                    onDragStart={(event) => { event.dataTransfer.setData('text/plain', lead.id); setDragging(lead.id); }}
                    onDragEnd={() => setDragging(null)} onClick={() => setOpen(lead.id)}>
                    <b>{lead.name}</b>
                    <span>{[nameOf(lists.data!.sources, lead.source_id), lead.interest].filter((item) => item && item !== '—').join(' · ') || 'Sem origem'}</span>
                    <span className="lead-card-foot">
                      {lead.next_contact_at
                        ? <span className={lead.next_contact_at < dateKey(new Date()) ? 'text-danger' : undefined}>Retorno {dayLabel(lead.next_contact_at)}</span>
                        : <span>{daysSince(lead.last_activity_at) === 0 ? 'Hoje' : `Há ${plural(daysSince(lead.last_activity_at), 'dia', 'dias')}`}</span>}
                      <span>{nameOf(lists.data!.owners, lead.owner_id).split(' ')[0]}</span>
                    </span>
                  </button>
                ))}
              </section>
            );
          })}
        </div>
      ) : (
        <Panel title="Leads" tools={<span className="muted small">{plural(leads.length, 'lead', 'leads')}</span>}>
          {leads.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Nome</th><th>Etapa</th><th>Origem</th><th>Interesse</th><th>Responsável</th><th>Entrou</th><th>Última atividade</th></tr></thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id}>
                      <td><button type="button" className="link-btn plain" onClick={() => setOpen(lead.id)}>{lead.name}</button>
                        <span className="sub">{lead.phone ?? lead.email}</span></td>
                      <td>{nameOf(stages, lead.stage_id)}</td>
                      <td>{nameOf(lists.data!.sources, lead.source_id)}</td>
                      <td>{lead.interest ?? '—'}</td>
                      <td>{nameOf(lists.data!.owners, lead.owner_id)}</td>
                      <td className="num-left">{dayLabel(lead.created_at)}</td>
                      <td className="num-left">{dayLabel(lead.last_activity_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <PanelState error="" loading={false} empty="Nenhum lead com esses filtros." />}
        </Panel>
      )}

      {creating && <LeadForm user={user} lead={null} lists={lists.data} onClose={() => setCreating(false)} onSaved={(id) => { reload(); setOpen(id); }} />}
      {open && !creating && (
        <LeadDetail user={user} leadId={open} lists={lists.data} onChanged={reload} onClose={() => {
          setOpen(null);
          if (window.location.hash.includes('lead=')) history.replaceState(null, '', '#/comercial');
        }} />
      )}
    </>
  );
}
