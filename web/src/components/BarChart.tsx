import { useState } from 'react';

// Barras agrupadas (até 2 séries, paleta validada para daltonismo): legenda, dica ao passar o mouse
// ou focar o grupo pelo teclado, e a mesma informação em tabela ("Ver tabela").
export const SERIES_COLORS = ['#8f2f57', '#c58b45'] as const;

export interface BarSeries { label: string; values: (number | null)[] }

const W = 760;
const H = 250;
const PAD = { top: 12, right: 8, bottom: 26, left: 64 };

function niceMax(value: number): number {
  if (value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= value / 4)! * magnitude;
  return Math.ceil(value / step) * step;
}

// Barra com cantos arredondados só no topo, presa à linha de base.
function bar(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

export function BarChart({ labels, fullLabels, series, format, extra, label }: {
  labels: string[];
  fullLabels: string[];
  series: BarSeries[];
  format: (value: number) => string;
  // Linhas a mais na dica e na tabela (ex.: resultado), por grupo.
  extra?: { label: string; values: (number | null)[]; format?: (value: number) => string }[];
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(Math.max(0, ...series.flatMap((item) => item.values.map((value) => value ?? 0))));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const group = plotW / labels.length;
  const barW = Math.min(24, (group - 14) / series.length);
  const y = (value: number) => PAD.top + plotH - (Math.max(0, value) / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => part * max);
  const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const show = (value: number | null, fmt = format) => (value === null ? '—' : fmt(value));

  return (
    <div className="cash-chart">
      <div className="chart-head">
        <ul className="legend" aria-label="Legenda">
          {series.map((item, index) => <li key={item.label}><i style={{ background: SERIES_COLORS[index] }} />{item.label}</li>)}
        </ul>
        <button type="button" className="link-btn no-print" onClick={() => setAsTable(!asTable)}>{asTable ? 'Ver gráfico' : 'Ver tabela'}</button>
      </div>

      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Período</th>{series.map((item) => <th key={item.label} className="num">{item.label}</th>)}
              {extra?.map((item) => <th key={item.label} className="num">{item.label}</th>)}</tr></thead>
            <tbody>
              {labels.map((_, index) => (
                <tr key={index}>
                  <td>{fullLabels[index]}</td>
                  {series.map((item) => <td key={item.label} className="num">{show(item.values[index])}</td>)}
                  {extra?.map((item) => <td key={item.label} className={(item.values[index] ?? 0) < 0 ? 'num text-danger' : 'num'}>{show(item.values[index], item.format)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-box" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}; use "Ver tabela" para os valores.`}>
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className={tick ? 'grid' : 'baseline'} />
                <text x={PAD.left - 8} y={y(tick)} className="axis" textAnchor="end" dominantBaseline="middle">{compact.format(tick)}</text>
              </g>
            ))}
            {labels.map((text, index) => {
              const x0 = PAD.left + index * group;
              const start = x0 + group / 2 - (barW * series.length + 2 * (series.length - 1)) / 2;
              return (
                <g key={index} className={hover !== null && hover !== index ? 'dim' : undefined}>
                  {series.map((item, s) => {
                    const value = item.values[index] ?? 0;
                    return value > 0 ? <path key={item.label} d={bar(start + s * (barW + 2), y(value), barW, y(0) - y(value))} fill={SERIES_COLORS[s]} /> : null;
                  })}
                  <text x={x0 + group / 2} y={H - 8} className="axis" textAnchor="middle">{text}</text>
                  <rect x={x0} y={PAD.top} width={group} height={plotH} className="hit" tabIndex={0}
                    aria-label={`${fullLabels[index]}: ${series.map((item) => `${item.label} ${show(item.values[index])}`).join(', ')}`}
                    onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chart-tip" role="status" style={{
              left: `${((PAD.left + (hover + 0.5) * group) / W) * 100}%`,
              transform: `translateX(${hover < 2 ? -15 : hover > labels.length - 3 ? -85 : -50}%)`
            }}>
              <b>{fullLabels[hover]}</b>
              {series.map((item, s) => (
                <span key={item.label}><i style={{ background: SERIES_COLORS[s] }} />{item.label} <strong>{show(item.values[hover])}</strong></span>
              ))}
              {extra?.map((item) => <span key={item.label} className="tip-total">{item.label} <strong>{show(item.values[hover], item.format)}</strong></span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
