import { useState } from 'react';
import type { CrmSummary } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Heading, Panel, PanelState } from '../../components/Page.tsx';
import { change, dateKey, money, monthEnd, monthKey, monthLabel } from '../../format.ts';
import { useLoad } from '../../hooks.ts';

const rate = (part: number, total: number) => (total ? (part / total) * 100 : null);
const pct = (value: number | null) => (value === null ? '—' : `${value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`);

// Painel comercial. Os leads do mês são uma coorte: conversões e faturamento contam o que esses leads
// fizeram até hoje. Comparações com o mês anterior e com o mesmo mês do ano passado.
export function CrmDashboardPage() {
  const now = new Date();
  const [month, setMonth] = useState(monthKey(now));
  const start = new Date(`${month}T12:00:00`);
  const previous = monthKey(new Date(start.getFullYear(), start.getMonth() - 1, 1));
  const lastYear = monthKey(new Date(start.getFullYear() - 1, start.getMonth(), 1));
  const { data, error } = useLoad(() => Promise.all([
    api.crmSummary(month, monthEnd(month)), api.crmSummary(previous, monthEnd(previous)), api.crmSummary(lastYear, monthEnd(lastYear)),
    api.crmMonthly(start.getFullYear())
  ]), [month]);

  const tools = (
    <label className="field-inline">Mês
      <input className="input compact" type="month" value={month.slice(0, 7)} max={dateKey(now).slice(0, 7)} required
        onChange={(event) => event.target.value && setMonth(`${event.target.value}-01`)} />
    </label>
  );
  if (!data) return <><Heading title="Painel comercial">{tools}</Heading><PanelState error={error} loading={!error} empty="" /></>;
  const [current, before, yearAgo, months] = data;
  const maxMonth = Math.max(1, ...months.map((item) => item.leads));
  const conversion = (summary: CrmSummary) => rate(summary.converted, summary.leads);

  return (
    <>
      <Heading title="Painel comercial" lead={`${monthLabel(month)}: leads que entraram no mês e o que aconteceu com eles até hoje.`}>{tools}</Heading>

      <section className="numbers finance-numbers" aria-label="Indicadores do mês">
        <Kpi label="leads" value={current.leads} before={before.leads} yearAgo={yearAgo.leads} format={String} />
        <Kpi label="convertidos em pacientes" value={current.converted} before={before.converted} yearAgo={yearAgo.converted} format={String} />
        <Kpi label="taxa de conversão" value={conversion(current) ?? 0} before={conversion(before) ?? 0} yearAgo={conversion(yearAgo) ?? 0}
          format={(value) => pct(current.leads ? value : null)} points />
        <Kpi label="compareceram à primeira sessão" value={current.attended} before={before.attended} yearAgo={yearAgo.attended} format={String} />
        <Kpi label="novos pacientes (todas as origens)" value={current.new_patients} before={before.new_patients} yearAgo={yearAgo.new_patients} format={String} />
        {current.revenue !== null && <Kpi label="faturamento desses leads" value={current.revenue} before={before.revenue ?? 0} yearAgo={yearAgo.revenue ?? 0} format={money} />}
        <div className="number">
          <strong>{current.avg_first_contact_hours === null ? '—' : current.avg_first_contact_hours < 1 ? 'menos de 1 h' : `${current.avg_first_contact_hours.toLocaleString('pt-BR')} h`}</strong>
          <span>tempo médio até o primeiro contato</span>
        </div>
      </section>

      <div className="finance-split">
        <Panel title="Por origem">
          {current.by_source.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Origem</th><th className="num">Leads</th><th className="num">Convertidos</th><th className="num">Conversão</th>
                  {current.revenue !== null && <th className="num">Faturamento</th>}</tr></thead>
                <tbody>
                  {current.by_source.map((item) => (
                    <tr key={item.name}>
                      <td>{item.name}</td><td className="num">{item.leads}</td><td className="num">{item.converted}</td>
                      <td className="num">{pct(rate(item.converted, item.leads))}</td>
                      {current.revenue !== null && <td className="num">{money(item.revenue)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty-state">Nenhum lead neste mês.</p>}
        </Panel>
        <Panel title="Etapas dos leads do mês">
          <div className="panel-body bars">
            {current.stages.map((item) => (
              <div key={item.name} className="bar-row">
                <span>{item.name}</span>
                <span className="share"><span style={{ width: `${current.leads ? (item.count / current.leads) * 100 : 0}%` }} className={`stage-${item.kind}`} /></span>
                <b>{item.count}</b>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Motivos de perda">
          {current.loss_reasons.length ? (
            <div className="panel-body bars">
              {current.loss_reasons.map((item) => (
                <div key={item.name} className="bar-row">
                  <span>{item.name}</span>
                  <span className="share"><span style={{ width: `${(item.count / current.lost) * 100}%` }} /></span>
                  <b>{item.count}</b>
                </div>
              ))}
            </div>
          ) : <p className="empty-state">Nenhuma perda neste mês.</p>}
        </Panel>
        <Panel title={`Mês a mês em ${start.getFullYear()}`}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Mês</th><th className="share-col">Leads</th><th className="num">Convertidos</th><th className="num">Novos pacientes</th></tr></thead>
              <tbody>
                {months.filter((item) => item.month <= dateKey(now)).map((item) => (
                  <tr key={item.month}>
                    <td>{monthLabel(item.month)}</td>
                    <td className="share-col"><span className="share"><span style={{ width: `${(item.leads / maxMonth) * 100}%` }} /></span>
                      <span className="share-value">{item.leads}</span></td>
                    <td className="num">{item.converted}</td>
                    <td className="num">{item.new_patients}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

function Kpi({ label, value, before, yearAgo, format, points = false }: {
  label: string; value: number; before: number; yearAgo: number; format: (value: number) => string; points?: boolean;
}) {
  // Taxa: diferença em pontos percentuais; demais: variação percentual.
  const delta = (base: number) => (points ? value - base : change(value, base));
  const show = (base: number, name: string) => {
    const d = delta(base);
    if (d === null) return <small>— vs {name}</small>;
    const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '';
    return <small className={d === 0 ? undefined : d > 0 ? 'delta-good' : 'delta-bad'}>
      {arrow} {Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}{points ? ' p.p.' : '%'} vs {name}</small>;
  };
  return (
    <div className="number">
      <strong>{format(value)}</strong>
      <span>{label}</span>
      <span className="kpi-compare">{show(before, 'mês anterior')}{show(yearAgo, 'mesmo mês do ano passado')}</span>
    </div>
  );
}
