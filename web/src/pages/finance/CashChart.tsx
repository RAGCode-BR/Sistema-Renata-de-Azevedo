import { useState } from 'react';
import type { FinanceMonth } from '../../../../shared/types.ts';
import { money, monthLabel } from '../../format.ts';

// Entradas x saídas de caixa, mês a mês. Duas séries com legenda, dica ao passar o mouse
// (ou focar o mês pelo teclado) e a mesma informação em tabela.
const IN = '#8f2f57';
const OUT = '#c58b45';
const W = 760;
const H = 250;
const PAD = { top: 12, right: 8, bottom: 26, left: 64 };

const outflow = (item: FinanceMonth) => item.expenses_paid + item.payouts_paid;

function niceMax(value: number): number {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((factor) => factor * magnitude >= value / 4)! * magnitude;
  return Math.ceil(value / step) * step;
}

// Barra com cantos arredondados só no topo, presa à linha de base.
function bar(x: number, y: number, width: number, height: number): string {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

export function CashChart({ months }: { months: FinanceMonth[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = niceMax(Math.max(...months.map((item) => Math.max(item.received, outflow(item)))));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const group = plotW / months.length;
  const barW = Math.min(24, (group - 14) / 2);
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((part) => part * max);
  const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
  const current = hover === null ? null : months[hover];

  return (
    <div className="cash-chart">
      <div className="chart-head">
        <ul className="legend" aria-label="Legenda">
          <li><i style={{ background: IN }} />Entradas (recebido)</li>
          <li><i style={{ background: OUT }} />Saídas (despesas pagas e repasses)</li>
        </ul>
        <button type="button" className="link-btn" onClick={() => setAsTable(!asTable)}>{asTable ? 'Ver gráfico' : 'Ver tabela'}</button>
      </div>

      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Mês</th><th className="num">Entradas</th><th className="num">Despesas pagas</th><th className="num">Repasses</th><th className="num">Resultado</th></tr></thead>
            <tbody>
              {months.map((item) => (
                <tr key={item.month}>
                  <td>{monthLabel(item.month)}</td>
                  <td className="num">{money(item.received)}</td>
                  <td className="num">{money(item.expenses_paid)}</td>
                  <td className="num">{money(item.payouts_paid)}</td>
                  <td className={item.cash_result < 0 ? 'num text-danger' : 'num'}>{money(item.cash_result)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-box" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Entradas e saídas de caixa por mês; use “Ver tabela” para os valores.">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className={tick ? 'grid' : 'baseline'} />
                <text x={PAD.left - 8} y={y(tick)} className="axis" textAnchor="end" dominantBaseline="middle">{compact.format(tick)}</text>
              </g>
            ))}
            {months.map((item, index) => {
              const x0 = PAD.left + index * group;
              const left = x0 + group / 2 - barW - 1;
              const right = x0 + group / 2 + 1;
              return (
                <g key={item.month} className={hover !== null && hover !== index ? 'dim' : undefined}>
                  {item.received > 0 && <path d={bar(left, y(item.received), barW, y(0) - y(item.received))} fill={IN} />}
                  {outflow(item) > 0 && <path d={bar(right, y(outflow(item)), barW, y(0) - y(outflow(item)))} fill={OUT} />}
                  <text x={x0 + group / 2} y={H - 8} className="axis" textAnchor="middle">{monthLabel(item.month, 'short').slice(0, 3)}</text>
                  <rect x={x0} y={PAD.top} width={group} height={plotH} className="hit" tabIndex={0}
                    aria-label={`${monthLabel(item.month)}: entradas ${money(item.received)}, saídas ${money(outflow(item))}`}
                    onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />
                </g>
              );
            })}
          </svg>
          {current && hover !== null && (
            <div className="chart-tip" style={{
              left: `${((PAD.left + (hover + 0.5) * group) / W) * 100}%`,
              transform: `translateX(${hover < 2 ? -15 : hover > months.length - 3 ? -85 : -50}%)`
            }} role="status">
              <b>{monthLabel(current.month)}</b>
              <span><i style={{ background: IN }} />Entradas <strong>{money(current.received)}</strong></span>
              <span><i style={{ background: OUT }} />Saídas <strong>{money(outflow(current))}</strong></span>
              <span className="tip-total">Resultado <strong>{money(current.cash_result)}</strong></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
