import { Select } from '../../components/Select.tsx';
import { useState } from 'react';
import { can } from '../../../../shared/permissions.ts';
import type { Campaign, NamedItem, SessionUser } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal } from '../../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dayLabel, money, parseMoney } from '../../format.ts';
import { text, useLoad } from '../../hooks.ts';

export const SITE_URL = 'https://renatadeazevedo.com.br/';

export function campaignLink(campaign: Pick<Campaign, 'utm_campaign' | 'source_name'>, page = SITE_URL): string {
  const source = (campaign.source_name ?? 'site').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-');
  return `${page}?utm_source=${encodeURIComponent(source)}&utm_medium=anuncio&utm_campaign=${encodeURIComponent(campaign.utm_campaign ?? '')}`;
}

const percent = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)}%` : '—');

// Campanhas desde o início: leads, convertidos, compareceram, faturamento e custos.
export function CampaignsPage({ user }: { user: SessionUser }) {
  const notify = useToast();
  const manage = can(user, 'crm.manage');
  const { data, error, reload } = useLoad(() => Promise.all([api.campaigns(), api.leadSources()]), []);
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const [campaigns, sources] = data ?? [[], []];

  return (
    <>
      <Heading title="Campanhas" lead="Investimento lançado à mão; leads, conversões e faturamento vêm do sistema.">
        {manage && <button type="button" className="button" disabled={!data} onClick={() => setEditing('new')}>Nova campanha</button>}
      </Heading>
      <Panel title="Resultados por campanha">
        {campaigns.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Campanha</th><th>Período</th><th className="num">Investimento</th><th className="num">Leads</th><th className="num">Convertidos</th>
                  <th className="num">Compareceram</th><th className="num">Custo por lead</th><th className="num">Custo por paciente</th>
                  {campaigns.some((item) => item.revenue !== null) && <th className="num">Faturamento</th>}
                  {manage && <th><span className="sr-only">Ações</span></th>}</tr>
              </thead>
              <tbody>
                {campaigns.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}<span className="sub">{[item.source_name, item.active ? null : 'encerrada'].filter(Boolean).join(' · ')}</span></td>
                    <td className="num-left">{item.starts_on ? `${dayLabel(item.starts_on)}${item.ends_on ? ` a ${dayLabel(item.ends_on)}` : ''}` : '—'}</td>
                    <td className="num">{money(item.budget)}</td>
                    <td className="num">{item.leads}</td>
                    <td className="num">{item.converted}<span className="sub">{percent(item.converted, item.leads)}</span></td>
                    <td className="num">{item.attended}</td>
                    <td className="num">{money(item.cost_per_lead)}</td>
                    <td className="num">{money(item.cost_per_patient)}</td>
                    {item.revenue !== null && <td className="num">{money(item.revenue)}</td>}
                    {manage && <td className="actions-cell"><button type="button" className="link-btn" onClick={() => setEditing(item)}>Editar</button></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhuma campanha cadastrada." />}
      </Panel>
      <p className="muted small">
        Para o lead do formulário do site entrar na campanha certa, use nos anúncios o link com o código da campanha
        (aparece ao editar). Leads do WhatsApp entram pela recepção, escolhendo a campanha no cadastro.
      </p>

      {editing && <CampaignForm campaign={editing === 'new' ? null : editing} sources={sources}
        onClose={() => setEditing(null)} onSaved={() => { notify('Campanha salva.'); reload(); }} />}
    </>
  );
}

function CampaignForm({ campaign, sources, onClose, onSaved }: {
  campaign: Campaign | null; sources: NamedItem[]; onClose: () => void; onSaved: () => void;
}) {
  const [code, setCode] = useState(campaign?.utm_campaign ?? '');
  const [sourceId, setSourceId] = useState(campaign?.source_id ?? '');
  const sourceName = sources.find((item) => item.id === sourceId)?.name ?? null;
  const slug = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <FormModal title={campaign ? 'Editar campanha' : 'Nova campanha'} submitLabel="Salvar" onClose={onClose} onSubmit={async (data) => {
      const budget = parseMoney(text(data, 'budget') || '0');
      if (Number.isNaN(budget) || budget < 0) throw new Error('Investimento: informe um valor válido (ex.: 1.500,00).');
      await api.saveCampaign(campaign?.id ?? null, {
        name: text(data, 'name'), source_id: sourceId || null, utm_campaign: slug(code) || null,
        starts_on: text(data, 'starts') || null, ends_on: text(data, 'ends') || null, budget, notes: text(data, 'notes') || null,
        active: campaign ? data.get('active') === 'on' : true
      });
      onSaved();
    }}>
      <Field label="Nome" full>
        <input className="input" name="name" required maxLength={120} defaultValue={campaign?.name}
          onBlur={(event) => { if (!code) setCode(slug(event.target.value)); }} />
      </Field>
      <Field label="Canal">
        <Select className="input" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          <option value="">Não informado</option>
          {sources.filter((item) => item.active || item.id === sourceId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
      </Field>
      <Field label="Investimento total">
        <input className="input" name="budget" inputMode="decimal" placeholder="0,00" defaultValue={campaign ? String(campaign.budget).replace('.', ',') : ''} />
      </Field>
      <Field label="Início"><input className="input" name="starts" type="date" defaultValue={campaign?.starts_on ?? ''} /></Field>
      <Field label="Fim"><input className="input" name="ends" type="date" defaultValue={campaign?.ends_on ?? ''} /></Field>
      <Field label="Código da campanha (para o link)" full>
        <input className="input" value={code} onChange={(event) => setCode(event.target.value)} placeholder="ex.: casal-outubro" maxLength={100} />
      </Field>
      {slug(code) && (
        <div className="full code-box">
          <span className="muted small">Link para usar no anúncio:</span>
          <code>{campaignLink({ utm_campaign: slug(code), source_name: sourceName })}</code>
          <button type="button" className="link-btn" onClick={() => navigator.clipboard?.writeText(campaignLink({ utm_campaign: slug(code), source_name: sourceName }))}>Copiar link</button>
        </div>
      )}
      <Field label="Observações" full><textarea className="input" name="notes" rows={2} maxLength={500} defaultValue={campaign?.notes ?? ''} /></Field>
      {campaign && (
        <label className="check full"><input type="checkbox" name="active" defaultChecked={campaign.active} /><span>Campanha ativa</span></label>
      )}
    </FormModal>
  );
}
