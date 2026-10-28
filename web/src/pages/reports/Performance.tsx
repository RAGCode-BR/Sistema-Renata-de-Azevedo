import { useState } from 'react';
import type { PerformanceReport } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Select } from '../../components/Select.tsx';
import { Heading, PanelState } from '../../components/Page.tsx';
import { useLoad } from '../../hooks.ts';
import { PrintButton, ReportTable, Stat, formatValue, ratio, usePeriod } from './shared.tsx';

type ProRow = PerformanceReport['professionals'][number];

export function PerformanceReportPage() {
  const { period, fields } = usePeriod();
  const [professional, setProfessional] = useState('');
  const [source, setSource] = useState('');
  const { data, error } = useLoad(() => Promise.all([
    api.reportPerformance(period.from, period.to, professional || null, source || null),
    api.professionals(), api.leadSources()
  ]), [period.from, period.to, professional, source]);
  const filters = <div className="report-filters no-print">{fields}
    <label className="field-inline">Equipe / profissional
      <Select className="input compact" value={professional} onChange={(event) => setProfessional(event.target.value)}>
        <option value="">Equipe inteira</option>
        {data?.[1].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select>
    </label>
    <label className="field-inline">Origem comercial
      <Select className="input compact" value={source} onChange={(event) => setSource(event.target.value)}>
        <option value="">Todas as origens</option>
        {data?.[2].map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Select>
    </label>
  </div>;
  const header = <><Heading title="Indicadores de desempenho" lead={period.label}><PrintButton /></Heading>{filters}</>;
  if (!data) return <>{header}<PanelState error={error} loading={!error} empty="" /></>;
  const [report] = data;
  return <>
    {header}
    <section className="numbers" aria-label="Indicadores">
      <Stat label="novos pacientes" value={formatValue(report.new_patients, 'int')} />
      <Stat label="encerraram acompanhamento" value={formatValue(report.ended_patients, 'int')} />
      <Stat label="conversão de leads" value={formatValue(ratio(report.converted, report.leads), 'pct')} />
      {report.financial_available && <>
        <Stat label="CAC estimado" value={formatValue(report.estimated_cac, 'money')} />
        <Stat label="LTV observado" value={formatValue(report.observed_ltv, 'money')} />
      </>}
    </section>
    <p className="muted report-method">
      Novos pacientes: cadastros no período. Conversão: leads criados no período que viraram pacientes até hoje.
      Encerramentos: pacientes marcados como alta ou inativos no período; o histórico começa em 27/10/2026.
    </p>
    {report.financial_available && <p className="muted report-method">
      CAC estimado = soma dos orçamentos completos das campanhas com leads neste recorte ÷ leads dessas campanhas que viraram pacientes.
      Não representa gasto efetivo no período. LTV observado = pagamentos não estornados recebidos até hoje dos pacientes
      cadastrados no período ÷ número desses pacientes. Não é projeção de receita futura.
    </p>}
    <ReportTable<ProRow> title="Comparação por profissional" rows={report.professionals}
      fileName={`desempenho-profissionais-${period.from}-${period.to}`} empty="Nenhuma profissional para este filtro."
      note="Leads são atribuídos à profissional preferida no CRM. Pacientes podem constar em mais de uma carteira. Crescimento usa as entradas e saídas registradas desde 27/10/2026; antes disso, o percentual não é calculado."
      columns={[
        { label: 'Profissional', value: (row) => row.professional_name },
        { label: 'Leads', value: (row) => row.leads, format: 'int' },
        { label: 'Convertidos', value: (row) => row.converted, format: 'int' },
        { label: 'Conversão', value: (row) => ratio(row.converted, row.leads), format: 'pct' },
        { label: 'Novos pacientes', value: (row) => row.new_patients, format: 'int' },
        { label: 'Encerraram', value: (row) => row.ended_patients, format: 'int' },
        { label: 'Carteira atual', value: (row) => row.linked_now, format: 'int' },
        { label: 'Entradas', value: (row) => row.entries, format: 'int' },
        { label: 'Saídas', value: (row) => row.exits, format: 'int' },
        { label: 'Crescimento', value: (row) => row.growth_percent, format: 'pct' }
      ]} />
    <ReportTable title="Motivos de encerramento" rows={report.exit_reasons}
      fileName={`desempenho-saidas-${period.from}-${period.to}`} empty="Nenhum encerramento registrado no período."
      columns={[
        { label: 'Motivo', value: (row) => row.name },
        { label: 'Pacientes', value: (row) => row.count, format: 'int', total: true },
        { label: 'Participação', value: (row) => ratio(row.count, report.ended_patients), format: 'pct' }
      ]} />
  </>;
}
