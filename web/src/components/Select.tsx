import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, OptionHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

type Choice = { value: string; label: string; disabled: boolean };
type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> & { children: ReactNode };

function labelOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(labelOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return labelOf(node.props.children);
  return '';
}

function choicesOf(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) return [];
    if (child.type === Fragment) return choicesOf(child.props.children);
    if (child.type !== 'option') return [];
    const label = labelOf(child.props.children) || String(child.props.label ?? child.props.value ?? '');
    return [{ value: String(child.props.value ?? label), label, disabled: Boolean(child.props.disabled) }];
  });
}

// O <select> oculto mantém FormData, validação e integração com formulários existentes.
// A lista visível é desenhada pelo sistema, inclusive dentro de <dialog>.
export function Select({ children, className = 'input', value, defaultValue, onChange, disabled, required,
  onInvalid, ...props }: SelectProps) {
  const choices = choicesOf(children);
  const [localValue, setLocalValue] = useState(String(defaultValue ?? choices[0]?.value ?? ''));
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [fieldLabel, setFieldLabel] = useState('');
  const [active, setActive] = useState(0);
  const [bounds, setBounds] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const trigger = useRef<HTMLButtonElement>(null);
  const native = useRef<HTMLSelectElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const listId = useId();
  const rawValue = String(value ?? localValue);
  const selected = choices.find((choice) => choice.value === rawValue) ?? choices[0];
  const selectedValue = selected?.value ?? '';
  const filtered = choices.filter((choice) => choice.label.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const enabled = filtered.map((choice, index) => choice.disabled ? -1 : index).filter((index) => index >= 0);

  useEffect(() => {
    const label = trigger.current?.closest('label')?.querySelector(':scope > span')?.textContent?.trim();
    if (label) setFieldLabel(label);
  }, []);

  useEffect(() => {
    if (native.current && native.current.value !== selectedValue) native.current.value = selectedValue;
  }, [selectedValue, children]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnScroll = (event: Event) => {
      if (menu.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', closeOnScroll);
    document.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', closeOnScroll);
      document.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (open && choices.length > 8) searchField.current?.focus();
  }, [open]);

  function show() {
    if (disabled || !trigger.current) return;
    const box = trigger.current.getBoundingClientRect();
    const availableBelow = window.innerHeight - box.bottom - 12;
    const desired = Math.min(320, Math.max(100, choices.length * 42 + (choices.length > 8 ? 52 : 12)));
    const above = availableBelow < Math.min(desired, 180) && box.top > availableBelow;
    const maxHeight = Math.min(320, Math.max(100, above ? box.top - 12 : availableBelow));
    setBounds({ left: box.left, top: above ? Math.max(8, box.top - Math.min(desired, maxHeight) - 6) : box.bottom + 6,
      width: box.width, maxHeight });
    setSearch('');
    setActive(Math.max(0, choices.findIndex((choice) => choice.value === selectedValue && !choice.disabled)));
    setOpen(true);
  }

  function choose(next: string) {
    setLocalValue(next);
    setInvalid(false);
    if (native.current) {
      native.current.value = next;
      onChange?.({ target: native.current, currentTarget: native.current } as ChangeEvent<HTMLSelectElement>);
    }
    setOpen(false);
    trigger.current?.focus();
  }

  function handleKey(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault(); show(); return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!enabled.length) return;
      const position = enabled.indexOf(active);
      setActive(event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled[enabled.length - 1]
        : enabled[(position + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length]);
    } else if (event.key === 'Enter' || (event.key === ' ' && document.activeElement !== searchField.current)) {
      event.preventDefault();
      if (filtered[active] && !filtered[active].disabled) choose(filtered[active].value);
    }
  }

  const popup = open && createPortal(<div className="app-select-menu" id={listId} ref={menu} role="listbox"
    aria-label={props['aria-label'] ?? fieldLabel} onKeyDown={handleKey}
    style={{ left: bounds.left, top: bounds.top, width: bounds.width, maxHeight: bounds.maxHeight }}>
    {choices.length > 8 && <input ref={searchField} className="app-select-search" type="search" placeholder="Buscar opção…"
      aria-label="Buscar opção" value={search} onChange={(event) => { setSearch(event.target.value); setActive(0); }} />}
    <div className="app-select-options">
      {filtered.length ? filtered.map((choice, index) => <button key={`${choice.value}-${index}`} type="button" role="option"
        className={index === active ? 'app-select-option active' : 'app-select-option'}
        aria-selected={choice.value === selectedValue} disabled={choice.disabled} onMouseEnter={() => setActive(index)}
        onClick={() => choose(choice.value)}>
        <span>{choice.label}</span>{choice.value === selectedValue && <span aria-hidden="true">✓</span>}
      </button>) : <p className="app-select-empty">Nenhuma opção encontrada.</p>}
    </div>
  </div>, trigger.current?.closest('dialog[open]') ?? document.body);

  return <span className={className.includes('compact') ? 'app-select compact' : 'app-select'}>
    <select {...props} ref={native} className="app-select-native" value={value} defaultValue={defaultValue}
      disabled={disabled} required={required} tabIndex={-1} aria-hidden="true"
      onChange={(event) => { setLocalValue(event.target.value); setInvalid(false); onChange?.(event); }}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); show(); trigger.current?.focus(); onInvalid?.(event); }}>
      {children}
    </select>
    <button ref={trigger} type="button" className={`${className} app-select-trigger${invalid ? ' invalid' : ''}`}
      role="combobox" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
      aria-label={props['aria-label'] ?? fieldLabel} aria-required={required || undefined} disabled={disabled}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={handleKey}>
      <span className="app-select-value">{selected?.label || 'Selecione'}</span><span className="app-select-chevron" aria-hidden="true" />
    </button>
    {invalid && <span className="app-select-validation" role="alert">Selecione uma opção.</span>}
    {popup}
  </span>;
}
