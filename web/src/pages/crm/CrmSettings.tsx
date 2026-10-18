import { useState } from 'react';
import type { ImportRow, LeadStage, NamedItem } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Field, FormModal } from '../../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { plural } from '../../format.ts';
import { errorMessage, text, useFormSubmit, useLoad } from '../../hooks.ts';
import { IMPORT_FIELDS, formSnippet, normalizeDate, parseCsv, trackerSnippet } from './siteForm.ts';

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lead-capture`;
const WHATSAPP = '5521999085192';
const KIND_LABEL: Record<string, string> = { open: 'Em andamento', won: 'Ganho (virou paciente)', lost: 'Perda' };

// Configurações do Comercial (crm.manage): responsável padrão, etapas, motivos, origens,
// formulário do site e importação de planilha.
export function CrmSettingsPage() {
  const notify = useToast();
  const { data, error, reload } = useLoad(() => Promise.all([
    api.crmSettings(), api.crmOwners(), api.leadStages(), api.lossReasons(), api.leadSources()
  ]), []);
  const [editing, setEditing] = useState<'stages' | 'lead_loss_reasons' | 'lead_sources' | null>(null);
  const owner = useFormSubmit(async (form) => {
    await api.saveCrmSettings(text(form, 'owner') || null);
    notify('Responsável padrão salvo.');
    reload();
  });

  if (!data) return <><Heading title="Configurações do comercial" /><PanelState error={error} loading={!error} empty="" /></>;
  const [settings, owners, stages, reasons, sources] = data;

  return (
    <>
      <Heading title="Configurações do comercial" lead="Funil, listas, formulário do site e importação." />

      <Panel title="Responsável pelos leads novos">
        <form className="panel-body form-grid" onSubmit={owner.onSubmit} key={settings.default_owner_id ?? 'nenhum'}>
          <Field label="Leads do site e da importação vão para">
            <select className="input" name="owner" defaultValue={settings.default_owner_id ?? ''}>
              <option value="">Ninguém (ficam sem responsável)</option>
              {owners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </Field>
          <p className="muted small full">Essa pessoa recebe um aviso no sino a cada lead novo do site e pode repassá-lo.</p>
          {owner.error && <p className="erro full" role="alert">{owner.error}</p>}
          <div className="full"><button type="submit" className="button" disabled={owner.busy}>{owner.busy ? 'Salvando…' : 'Salvar'}</button></div>
        </form>
      </Panel>

      <div className="finance-split">
        <Panel title="Etapas do funil" tools={<button type="button" className="link-btn" onClick={() => setEditing('stages')}>Editar</button>}>
          <ol className="panel-body plain-list">{stages.map((item) => <li key={item.id} className={item.active ? undefined : 'muted'}>{item.name}<span className="sub">{KIND_LABEL[item.kind]}{item.active ? '' : ' · desativada'}</span></li>)}</ol>
        </Panel>
        <Panel title="Motivos de perda" tools={<button type="button" className="link-btn" onClick={() => setEditing('lead_loss_reasons')}>Editar</button>}>
          <ul className="panel-body plain-list">{reasons.map((item) => <li key={item.id} className={item.active ? undefined : 'muted'}>{item.name}</li>)}</ul>
        </Panel>
        <Panel title="Origens" tools={<button type="button" className="link-btn" onClick={() => setEditing('lead_sources')}>Editar</button>}>
          <ul className="panel-body plain-list">{sources.map((item) => <li key={item.id} className={item.active ? undefined : 'muted'}>{item.name}</li>)}</ul>
        </Panel>
      </div>

      <SiteFormPanel />
      <ImportPanel sources={sources} onImported={reload} />

      {editing === 'stages' && <StagesDialog stages={stages} onClose={() => setEditing(null)} onSaved={() => { notify('Etapas salvas.'); reload(); }} />}
      {(editing === 'lead_loss_reasons' || editing === 'lead_sources') && (
        <ItemsDialog table={editing} items={editing === 'lead_sources' ? sources : reasons} onClose={() => setEditing(null)}
          onSaved={() => { notify('Lista salva.'); reload(); }} />
      )}
    </>
  );
}

function StagesDialog({ stages, onClose, onSaved }: { stages: LeadStage[]; onClose: () => void; onSaved: () => void }) {
  return (
    <FormModal title="Etapas do funil" submitLabel="Salvar" onClose={onClose} onSubmit={async (data) => {
      for (const stage of stages) {
        const name = text(data, `name-${stage.id}`);
        const position = Number(text(data, `pos-${stage.id}`));
        const active = stage.kind !== 'open' || data.get(`active-${stage.id}`) === 'on';
        if (!Number.isInteger(position)) throw new Error('A ordem precisa ser um número inteiro.');
        if (name !== stage.name || position !== stage.position || active !== stage.active) await api.saveStage({ id: stage.id, name, position, active });
      }
      const added = text(data, 'new');
      if (added) await api.saveStage({ id: null, name: added, position: Math.max(0, ...stages.filter((s) => s.kind === 'open').map((s) => s.position)) + 1, active: true });
      onSaved();
    }}>
      <p className="muted small full">Ordem: número menor aparece antes. "Convertido" e "Perdido" podem ser renomeadas, mas não desativadas.</p>
      {stages.map((stage) => (
        <div key={stage.id} className="named-row full">
          <input className="input" name={`pos-${stage.id}`} type="number" defaultValue={stage.position} aria-label={`Ordem de ${stage.name}`} style={{ maxWidth: 80 }} />
          <input className="input" name={`name-${stage.id}`} required maxLength={60} defaultValue={stage.name} aria-label={`Nome de ${stage.name}`} />
          {stage.kind === 'open'
            ? <label className="check"><input type="checkbox" name={`active-${stage.id}`} defaultChecked={stage.active} /><span>Ativa</span></label>
            : <span className="muted small">{KIND_LABEL[stage.kind]}</span>}
        </div>
      ))}
      <Field label="Nova etapa (em andamento)" full><input className="input" name="new" maxLength={60} placeholder="Opcional" /></Field>
    </FormModal>
  );
}

function ItemsDialog({ table, items, onClose, onSaved }: {
  table: 'lead_sources' | 'lead_loss_reasons'; items: NamedItem[]; onClose: () => void; onSaved: () => void;
}) {
  return (
    <FormModal title={table === 'lead_sources' ? 'Origens' : 'Motivos de perda'} submitLabel="Salvar" onClose={onClose} onSubmit={async (data) => {
      for (const item of items) {
        const name = text(data, `name-${item.id}`);
        const active = data.get(`active-${item.id}`) === 'on';
        if (name !== item.name || active !== item.active) await api.saveCrmItem(table, { id: item.id, name, active });
      }
      const added = text(data, 'new');
      if (added) await api.saveCrmItem(table, { id: null, name: added, active: true });
      onSaved();
    }}>
      {items.map((item) => (
        <div key={item.id} className="named-row full">
          <input className="input" name={`name-${item.id}`} required maxLength={80} defaultValue={item.name} aria-label={`Nome de ${item.name}`} />
          <label className="check"><input type="checkbox" name={`active-${item.id}`} defaultChecked={item.active} /><span>Ativo</span></label>
        </div>
      ))}
      <Field label="Adicionar" full><input className="input" name="new" maxLength={80} placeholder="Novo nome (opcional)" /></Field>
    </FormModal>
  );
}

function CopyBox({ label, code }: { label: string; code: string }) {
  const notify = useToast();
  return (
    <div className="code-box">
      <div className="code-head"><b>{label}</b>
        <button type="button" className="link-btn" onClick={() => navigator.clipboard?.writeText(code).then(() => notify('Código copiado.'))}>Copiar código</button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function SiteFormPanel() {
  const [open, setOpen] = useState(false);
  return (
    <Panel title="Formulário de contato do site" tools={<button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Esconder códigos' : 'Ver códigos'}</button>}>
      <div className="panel-body stack">
        <p>Os contatos enviados pelo formulário entram no funil como "Novo contato", com a origem e a campanha do link do anúncio, e avisam o responsável padrão.</p>
        <ol className="steps">
          <li>No WordPress do site, edite o tema (ou use um plugin de cabeçalho) e cole o <b>rastreador</b> no cabeçalho de todas as páginas.</li>
          <li>Na página de contato (ou nas páginas de serviço), adicione um bloco <b>HTML personalizado</b> e cole o <b>formulário</b>.</li>
          <li>Nos anúncios, use o link gerado em <b>Campanhas</b>, que leva o código da campanha.</li>
        </ol>
        {open && <>
          <CopyBox label="1. Rastreador (cabeçalho)" code={trackerSnippet()} />
          <CopyBox label="2. Formulário" code={formSnippet(ENDPOINT, WHATSAPP)} />
        </>}
        <p className="muted small">O endereço do site precisa estar na lista de origens permitidas da função (renatadeazevedo.com.br já está).</p>
      </div>
    </Panel>
  );
}

function ImportPanel({ sources, onImported }: { sources: NamedItem[]; onImported: () => void }) {
  const notify = useToast();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [defaultSource, setDefaultSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');

  async function read(file: File) {
    setResult('');
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) { notify('A planilha precisa ter a linha de títulos e pelo menos uma linha de dados.'); return; }
    const header = parsed[0].map((cell) => cell.trim().toLowerCase());
    const auto: Record<string, number> = {};
    for (const [key, , pattern] of IMPORT_FIELDS) {
      const index = header.findIndex((cell, position) => pattern.test(cell) && !Object.values(auto).includes(position));
      if (index >= 0) auto[key] = index;
    }
    setMapping(auto);
    setRows(parsed);
    setFileName(file.name);
  }

  const data: ImportRow[] = (rows ?? []).slice(1).map((row) => {
    const value = (key: string) => (mapping[key] === undefined ? '' : (row[mapping[key]] ?? '').trim());
    return { name: value('name'), phone: value('phone'), email: value('email'), source: value('source'), campaign: value('campaign'),
      stage: value('stage'), created_at: normalizeDate(value('created_at')), notes: value('notes') };
  });

  async function run() {
    setBusy(true);
    try {
      let inserted = 0, skipped = 0, invalid = 0;
      for (let start = 0; start < data.length; start += 1000) {
        const part = await api.importLeads(data.slice(start, start + 1000), defaultSource || null);
        inserted += part.inserted; skipped += part.skipped; invalid += part.invalid;
      }
      setResult(`${plural(inserted, 'lead importado', 'leads importados')}; ${plural(skipped, 'já existia', 'já existiam')} (mesmo telefone ou e-mail); ${plural(invalid, 'linha sem nome ou contato', 'linhas sem nome ou contato')}.`);
      setRows(null);
      onImported();
    } catch (failure) {
      notify(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Importar planilha (ex.: exportação do Converte)">
      <div className="panel-body stack">
        <p className="muted small">Arquivo CSV (no Excel: "Salvar como" → CSV). A primeira linha deve ter os títulos das colunas. Contatos já cadastrados (mesmo telefone ou e-mail) são pulados.</p>
        <label className="field-inline">Arquivo
          <input type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) read(file); event.target.value = ''; }} />
        </label>
        {result && <p className="notice" role="status">{result}</p>}
        {rows && <>
          <p><b>{fileName}</b>: {plural(rows.length - 1, 'linha', 'linhas')}. Confira qual coluna corresponde a cada campo:</p>
          <div className="form-grid">
            {IMPORT_FIELDS.map(([key, label]) => (
              <Field key={key} label={label}>
                <select className="input" value={mapping[key] ?? ''} onChange={(event) => {
                  const next = { ...mapping };
                  if (event.target.value === '') delete next[key]; else next[key] = Number(event.target.value);
                  setMapping(next);
                }}>
                  <option value="">Não importar</option>
                  {rows[0].map((cell, index) => <option key={index} value={index}>{cell || `Coluna ${index + 1}`}</option>)}
                </select>
              </Field>
            ))}
            <Field label="Origem quando a planilha não informar">
              <select className="input" value={defaultSource} onChange={(event) => setDefaultSource(event.target.value)}>
                <option value="">Sem origem</option>
                {sources.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nome</th><th>Telefone</th><th>E-mail</th><th>Origem</th><th>Etapa</th><th>Entrada</th></tr></thead>
              <tbody>{data.slice(0, 5).map((row, index) => (
                <tr key={index}><td>{row.name || '—'}</td><td>{row.phone || '—'}</td><td>{row.email || '—'}</td><td>{row.source || '—'}</td><td>{row.stage || '—'}</td><td>{row.created_at || '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div><button type="button" className="button" disabled={busy || mapping.name === undefined} onClick={run}>
            {busy ? 'Importando…' : `Importar ${plural(data.length, 'linha', 'linhas')}`}</button>
            {mapping.name === undefined && <span className="muted small"> Escolha a coluna do nome.</span>}</div>
        </>}
      </div>
    </Panel>
  );
}
