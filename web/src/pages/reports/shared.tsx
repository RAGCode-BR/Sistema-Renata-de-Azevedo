import { useState } from 'react';
import type { ReactNode } from 'react';
import type { Professional } from '../../../../shared/types.ts';
import { Panel } from '../../components/Page.tsx';
import { dateKey, dayLabel, money } from '../../format.ts';

// Período ------------------------------------------------------------------------------------------

type Preset = 'mes' | 'mes-anterior' | 'trimestre' | 'ano' | 'ano-anterior' | 'personalizado';
const PRESETS: [Preset, string][] = [
  ['mes', 'Este mês'], ['mes-anterior', 'Mês passado'], ['trimestre', 'Este trimestre'], ['ano', 'Este ano'],
  ['ano-anterior', 'Ano passado'], ['personalizado', 'Outro período']
];

function range(preset: Preset): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'mes-anterior': return { from: dateKey(new Date(y, m - 1, 1)), to: dateKey(new Date(y, m, 0)) };
    case 'trimestre': { const q = Math.floor(m / 3) * 3; return { from: dateKey(new Date(y, q, 1)), to: dateKey(new Date(y, q + 3, 0)) }; }
    case 'ano': return { from: `${y}-01-01`, to: `${y}-12-31` };
    case 'ano-anterior': return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    default: return { from: dateKey(new Date(y, m, 1)), to: dateKey(new Date(y, m + 1, 0)) };
  }
}

export interface Period { from: string; to: string; label: string }

export function usePeriod(initial: Preset = 'mes') {
  const [preset, setPreset] = useState<Preset>(initial);
  const [custom, setCustom] = useState(range(initial));
  const value = preset === 'personalizado' ? custom : range(preset);
  const period: Period = { ...value, label: `${dayLabel(value.from)} a ${dayLabel(value.to)}` };

  const control = (
    <div className="report-filters no-print">
      <label className="field-inline">Período
        <select className="input compact" value={preset} onChange={(event) => {
          const next = event.target.value as Preset;
          if (next === 'personalizado') setCustom(value);
          setPreset(next);
        }}>
          {PRESETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>
      {preset === 'personalizado' && <>
        <label className="field-inline">De
          <input className="input compact" type="date" value={custom.from} max={custom.to} required
            onChange={(event) => event.target.value && setCustom({ ...custom, from: event.target.value })} />
        </label>
        <label className="field-inline">até
          <input className="input compact" type="date" value={custom.to} min={custom.from} required
            onChange={(event) => event.target.value && setCustom({ ...custom, to: event.target.value })} />
        </label>
      </>}
    </div>
  );
  return { period, control };
}

export function ProfessionalFilter({ professionals, value, onChange }: { professionals: Professional[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="field-inline no-print">Profissional
      <select className="input compact" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Todas</option>
        {professionals.map((item) => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (inativa)'}</option>)}
      </select>
    </label>
  );
}

// Formatos -----------------------------------------------------------------------------------------

export type Format = 'text' | 'int' | 'money' | 'pct' | 'date';

export const ratio = (part: number, total: number): number | null => (total ? (part / total) * 100 : null);

export function formatValue(value: string | number | null | undefined, format: Format): string {
  if (value === null || value === undefined || value === '') return '—';
  // `|| 0` também evita o "-R$ 0,00" de zeros negativos.
  if (format === 'money') return money(Number(value) || 0);
  if (format === 'pct') return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  if (format === 'int') return Number(value).toLocaleString('pt-BR');
  if (format === 'date') return dayLabel(String(value));
  return String(value);
}

// CSV para o Excel brasileiro: ponto e vírgula, vírgula decimal e BOM (acentos corretos).
function csvCell(value: string | number | null | undefined, format: Format): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || format === 'money' || format === 'int' || format === 'pct') {
    return Number(value).toFixed(format === 'int' ? 0 : 2).replace('.', ',');
  }
  const text = format === 'date' ? dayLabel(String(value)) : String(value);
  return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(fileName: string, header: string[], rows: string[][]) {
  const content = '﻿' + [header, ...rows].map((row) => row.join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `${fileName}.csv` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Tabela de relatório ------------------------------------------------------------------------------

export interface Column<T> {
  label: string;
  value: (row: T) => string | number | null;
  format?: Format;
  // Soma na linha de total (ou função própria, para taxas).
  total?: true | ((rows: T[]) => number | null);
}

export function ReportTable<T>({ title, rows, columns, fileName, empty, note }: {
  title: string; rows: T[]; columns: Column<T>[]; fileName: string; empty: string; note?: ReactNode;
}) {
  const hasTotals = rows.length > 1 && columns.some((column) => column.total);
  const totalOf = (column: Column<T>) => {
    if (!column.total) return null;
    if (column.total === true) return rows.reduce((sum, row) => sum + Number(column.value(row) ?? 0), 0);
    return column.total(rows);
  };
  const exportCsv = () => {
    const body = rows.map((row) => columns.map((column) => csvCell(column.value(row), column.format ?? 'text')));
    if (hasTotals) body.push(columns.map((column, index) => (index === 0 ? 'Total' : column.total ? csvCell(totalOf(column), column.format ?? 'int') : '')));
    downloadCsv(fileName, columns.map((column) => column.label), body);
  };
  const numeric = (column: Column<T>) => column.format && column.format !== 'text' && column.format !== 'date';

  return (
    <Panel title={title} tools={rows.length ? <button type="button" className="link-btn no-print" onClick={exportCsv}>Exportar CSV</button> : undefined}>
      {rows.length ? (
        <div className="table-wrap">
          <table className="table report-table">
            <thead><tr>{columns.map((column) => <th key={column.label} className={numeric(column) ? 'num' : undefined}>{column.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>{columns.map((column) => {
                  const value = column.value(row);
                  return <td key={column.label} className={`${numeric(column) ? 'num' : ''}${typeof value === 'number' && value < 0 ? ' text-danger' : ''}`}>
                    {formatValue(value, column.format ?? 'text')}</td>;
                })}</tr>
              ))}
            </tbody>
            {hasTotals && (
              <tfoot><tr>{columns.map((column, index) => (
                <td key={column.label} className={numeric(column) ? 'num' : undefined}>
                  {index === 0 ? 'Total' : column.total ? formatValue(totalOf(column), column.format ?? 'int') : ''}</td>
              ))}</tr></tfoot>
            )}
          </table>
        </div>
      ) : <p className="empty-state">{empty}</p>}
      {note && <p className="muted small panel-note">{note}</p>}
    </Panel>
  );
}

export function PrintButton() {
  return <button type="button" className="button light no-print" onClick={() => window.print()}>Imprimir / PDF</button>;
}

// Indicador simples (sem comparação).
export function Stat({ value, label, danger = false }: { value: string; label: string; danger?: boolean }) {
  return <div className="number"><strong className={danger ? 'text-danger' : undefined}>{value}</strong><span>{label}</span></div>;
}
