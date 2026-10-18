import { useState } from 'react';
import type { CaseFormulation, FormulationSection, FormulationTemplate } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { ConfirmModal, Field, FormModal, Modal } from '../../components/Modal.tsx';
import { Panel } from '../../components/Page.tsx';
import { useToast } from '../../components/Toast.tsx';
import { dateTime, plural } from '../../format.ts';
import { errorMessage, text, useLoad } from '../../hooks.ts';

interface FormulationProps {
  patientId: string;
  professionalId: string;
  formulation: CaseFormulation | null;
  onChanged: () => void;
}

interface Working { templateName: string; sections: FormulationSection[] }

// Conceitualização de caso por seções. O modelo (da clínica ou da profissional) só define as seções;
// elas ficam copiadas na conceitualização, e trocar de modelo mantém o texto das seções com a mesma chave.
export function Formulation({ patientId, professionalId, formulation, onChanged }: FormulationProps) {
  const notify = useToast();
  const templates = useLoad(api.formulationTemplates, []);
  const [working, setWorking] = useState<Working | null>(formulation
    ? { templateName: formulation.template_name, sections: formulation.sections } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [managing, setManaging] = useState(false);
  const list = templates.data ?? [];

  function apply(templateId: string) {
    const template = list.find((item) => item.id === templateId);
    if (template) setWorking({ templateName: template.name, sections: template.sections });
  }

  async function save(form: HTMLFormElement) {
    if (!working) return;
    const data = new FormData(form);
    // Texto de seções que saíram do modelo continua guardado (não se perde ao trocar de modelo).
    const content: Record<string, string> = { ...(formulation?.content ?? {}) };
    for (const section of working.sections) content[section.key] = String(data.get(section.key) ?? '');
    setBusy(true);
    setError('');
    try {
      await api.saveFormulation(patientId, working.templateName, working.sections, content);
      notify('Conceitualização salva.');
      onChanged();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel title="Conceitualização de caso" tools={
        <div className="tools">
          {list.length > 0 && (
            <select className="input compact" aria-label="Aplicar modelo" value="" onChange={(event) => apply(event.target.value)}>
              <option value="" disabled>{working ? 'Trocar de modelo…' : 'Escolher modelo…'}</option>
              {list.map((item) => <option key={item.id} value={item.id}>{item.name}{item.professional_id ? '' : ' (clínica)'}</option>)}
            </select>
          )}
          <button type="button" className="link-btn" onClick={() => setManaging(true)}>Meus modelos</button>
        </div>
      }>
        {!working ? (
          <div className="panel-body stack">
            <p className="muted">Escolha um modelo para começar. O modelo da clínica traz as seções combinadas; você pode criar o seu, com as seções da sua abordagem.</p>
            {templates.error && <p className="erro" role="alert">{templates.error}</p>}
          </div>
        ) : (
          <form className="panel-body stack" key={working.sections.map((section) => section.key).join('|')}
            onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget); }}>
            <p className="muted small">
              Modelo: {working.templateName}
              {formulation && ` · atualizada em ${dateTime(formulation.updated_at)}`}
              {formulation && formulation.revisions > 0 && ` · ${plural(formulation.revisions, 'versão anterior guardada', 'versões anteriores guardadas')}`}
            </p>
            {working.sections.map((section) => (
              <label key={section.key} className="field">
                <span>{section.label}</span>
                {section.hint && <span className="sub">{section.hint}</span>}
                <textarea className="input" name={section.key} rows={3} defaultValue={formulation?.content[section.key] ?? ''} />
              </label>
            ))}
            {error && <p className="erro" role="alert">{error}</p>}
            <button type="submit" className="button" disabled={busy}>{busy ? 'Salvando…' : 'Salvar conceitualização'}</button>
          </form>
        )}
      </Panel>

      {managing && (
        <TemplatesManager professionalId={professionalId} templates={list} onClose={() => setManaging(false)} onChanged={templates.reload} />
      )}
    </>
  );
}

// "Título — dica" por linha → seções com chaves estáveis (a chave identifica o texto de cada seção).
function parseSections(value: string, previous: FormulationSection[]): FormulationSection[] {
  const used = new Set<string>();
  return value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [label = '', ...hint] = line.split(/\s+—\s+|\s+-\s+/);
    const known = previous.find((section) => section.label === label.trim());
    let key = known?.key ?? (label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'secao');
    while (used.has(key)) key += '_';
    used.add(key);
    return { key, label: label.trim(), hint: hint.join(' — ').trim() };
  });
}

const toLines = (sections: FormulationSection[]) => sections.map((section) => (section.hint ? `${section.label} — ${section.hint}` : section.label)).join('\n');

function TemplatesManager({ professionalId, templates, onClose, onChanged }: {
  professionalId: string; templates: FormulationTemplate[]; onClose: () => void; onChanged: () => void;
}) {
  const notify = useToast();
  const [editing, setEditing] = useState<FormulationTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<FormulationTemplate | null>(null);
  const own = templates.filter((item) => item.professional_id);
  const base = templates.find((item) => !item.professional_id);

  if (editing) {
    const current = editing === 'new' ? null : editing;
    const startFrom = current ?? base;
    return (
      <FormModal title={current ? `Editar ${current.name}` : 'Novo modelo'} submitLabel="Salvar modelo" onClose={() => setEditing(null)} onSubmit={async (data) => {
        const sections = parseSections(text(data, 'sections'), startFrom?.sections ?? []);
        if (!sections.length) throw new Error('Inclua ao menos uma seção.');
        await api.saveFormulationTemplate({ id: current?.id ?? null, professionalId, name: text(data, 'name'), sections });
        notify('Modelo salvo.');
        onChanged();
      }}>
        <Field label="Nome do modelo" full><input className="input" name="name" required maxLength={100} defaultValue={current?.name ?? 'Meu modelo'} /></Field>
        <Field label="Seções (uma por linha; dica opcional depois de um travessão)" full>
          <textarea className="input" name="sections" rows={12} required defaultValue={startFrom ? toLines(startFrom.sections) : ''} />
        </Field>
        <p className="muted small full">Mudar o modelo não altera conceitualizações já escritas; para usá-lo, escolha-o em &ldquo;Trocar de modelo&rdquo;.</p>
      </FormModal>
    );
  }

  return (
    <Modal title="Meus modelos de conceitualização" onClose={onClose}>
      <div className="modal-body stack">
        {own.length ? own.map((item) => (
          <div key={item.id} className="template-row">
            <span><strong>{item.name}</strong><span className="sub">{plural(item.sections.length, 'seção', 'seções')}</span></span>
            <span className="entry-actions">
              <button type="button" className="link-btn" onClick={() => setEditing(item)}>Editar</button>
              <button type="button" className="link-btn danger" onClick={() => setDeleting(item)}>Excluir</button>
            </span>
          </div>
        )) : <p className="muted">Você ainda não tem modelos próprios. O novo modelo começa com as seções do modelo da clínica.</p>}
        <button type="button" className="button" onClick={() => setEditing('new')}>Novo modelo</button>
      </div>
      {deleting && (
        <ConfirmModal title="Excluir modelo" confirmLabel="Excluir modelo" onClose={() => setDeleting(null)} onConfirm={async () => {
          await api.deleteFormulationTemplate(deleting.id);
          notify('Modelo excluído.');
          onChanged();
        }}>
          <p className="modal-text">Excluir o modelo <strong>{deleting.name}</strong>? Conceitualizações já escritas com ele não mudam.</p>
        </ConfirmModal>
      )}
    </Modal>
  );
}
