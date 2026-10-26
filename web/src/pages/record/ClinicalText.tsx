import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

// O prontuário guarda texto, não HTML. React escapa o conteúdo antes de exibi-lo,
// inclusive nas versões anteriores e na exportação.
function inline(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push(value.slice(cursor, index));
    parts.push(match[2] ? <strong key={index}>{match[2]}</strong> : <em key={index}>{match[3]}</em>);
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
}

export function ClinicalText({ body }: { body: string }) {
  const lines = body.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(<p key={`p-${blocks.length}`}>{paragraph.map((line, index) => <span key={index}>{index > 0 && <br />}{inline(line)}</span>)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push(<ul key={`l-${blocks.length}`}>{list.map((item, index) => <li key={index}>{inline(item)}</li>)}</ul>);
    list = [];
  };
  for (const line of lines) {
    const bullet = /^\s*[-•] (.+)$/.exec(line);
    if (bullet) { flushParagraph(); list.push(bullet[1]); }
    else if (!line.trim()) { flushParagraph(); flushList(); }
    else { flushList(); paragraph.push(line); }
  }
  flushParagraph(); flushList();
  return <div className="clinical-text">{blocks}</div>;
}

interface ClinicalEditorProps {
  value: string;
  onChange: (value: string) => void;
  name?: string;
  disabled?: boolean;
  label?: string;
}

export function ClinicalEditor({ value, onChange, name = 'body', disabled = false, label = 'Evolução' }: ClinicalEditorProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function format(kind: 'bold' | 'italic' | 'list') {
    const editor = field.current;
    if (!editor || disabled) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = value.slice(start, end);
    const marker = kind === 'bold' ? '**' : '*';
    const insertion = kind === 'list'
      ? (selected || 'Item da lista').split('\n').map((line) => `- ${line.replace(/^\s*[-•] /, '')}`).join('\n')
      : `${marker}${selected || 'texto'}${marker}`;
    onChange(value.slice(0, start) + insertion + value.slice(end));
    requestAnimationFrame(() => {
      editor.focus();
      const offset = kind === 'list' ? 2 : marker.length;
      editor.setSelectionRange(start + offset, start + offset + (selected || (kind === 'list' ? 'Item da lista' : 'texto')).length);
    });
  }

  return (
    <div className="clinical-editor">
      <div className="clinical-editor-bar" role="toolbar" aria-label="Formatação da evolução">
        <button type="button" className="clinical-format" disabled={disabled} title="Negrito (Ctrl+B)" aria-label="Negrito" onClick={() => format('bold')}><strong>B</strong></button>
        <button type="button" className="clinical-format" disabled={disabled} title="Itálico (Ctrl+I)" aria-label="Itálico" onClick={() => format('italic')}><em>I</em></button>
        <button type="button" className="clinical-format" disabled={disabled} aria-label="Lista" onClick={() => format('list')}>☷ Lista</button>
        <button type="button" className="clinical-preview-toggle" aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? 'Voltar ao texto' : 'Visualizar formatação'}</button>
      </div>
      {preview ? <div className="clinical-preview" aria-label="Prévia da evolução">{value.trim() ? <ClinicalText body={value} /> : <p className="muted">Escreva a evolução para visualizar.</p>}</div>
        : <textarea ref={field} className="input clinical-editor-input" name={name} aria-label={label} rows={10} value={value} disabled={disabled}
          onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
              event.preventDefault(); format(event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
            }
          }} />}
      <p className="muted small clinical-editor-help">Selecione uma palavra para formatar. A prévia mostra como a evolução ficará no histórico e na exportação.</p>
    </div>
  );
}
