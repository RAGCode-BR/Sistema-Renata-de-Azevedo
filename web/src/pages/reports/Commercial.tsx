import type { CampaignReportRow } from '../../../../shared/types.ts';
import { api } from '../../api.ts';
import { Heading, PanelState } from '../../components/Page.tsx';
import { useLoad } from '../../hooks.ts';
import { PrintButton, ReportTable, Stat, formatValue, ratio, usePeriod } from './shared.tsx';

// Relatório comercial: leads que entraram no período e o que aconteceu com eles até hoje.
export function CommercialReportPage() {
  const { period, control } = usePeriod();
  const { data, error } = useLoad(() => Promise.all([
    api.crmSummary(period.from, period.to), api.reportCampaigns(period.from, period.to)
  ]), [period.from, period.to]);

  const header = <><Heading title="Relatório comercial" lead={period.label}><PrintButton /></Heading>{control}</>;
  if (!data) return <>{header}<PanelState error={error} loading={!error} empty="" /></>;
  const [summary, campaigns] = data;
  const money = summary.revenue !== null;
  const roi = (row: CampaignReportRow) => (row.revenue === null || !row.budget ? null : ((row.revenue - row.budget) / row.budget) * 100);

  return (
    <>
      {header}
      <section className="numbers" aria-label="Resumo">
        <Stat value={formatValue(summary.leads, 'int')} label="leads" />
        <Stat value={formatValue(summary.converted, 'int')} label="viraram pacientes" />
        <Stat value={formatValue(ratio(summary.converted, summary.leads), 'pct')} label="taxa de conversão" />
        <Stat value={formatValue(summary.attended, 'int')} label="compareceram à primeira sessão" />
        {money && <Stat value={formatValue(summary.revenue, 'money')} label="faturamento desses pacientes" />}
        <Stat value={formatValue(summary.new_patients, 'int')} label="novos pacientes (todas as origens)" />
      </section>

      <ReportTable title="Por origem" rows={summary.by_source} fileName={`comercial-origens-${period.from}-${period.to}`} empty="Nenhum lead no período."
        columns={[
          { label: 'Origem', value: (row) => row.name },
          { label: 'Leads', value: (row) => row.leads, format: 'int', total: true },
          { label: 'Convertidos', value: (row) => row.converted, format: 'int', total: true },
          { label: 'Conversão', value: (row) => ratio(row.converted, row.leads), format: 'pct',
            total: (rows) => ratio(rows.reduce((s, r) => s + r.converted, 0), rows.reduce((s, r) => s + r.leads, 0)) },
          { label: 'Compareceram', value: (row) => row.attended, format: 'int', total: true },
          { label: 'Perdidos', value: (row) => row.lost, format: 'int', total: true },
          ...(money ? [{ label: 'Faturamento', value: (row: (typeof summary.by_source)[number]) => row.revenue, format: 'money' as const, total: true as const }] : [])
        ]} />

      <ReportTable title="Campanhas" rows={campaigns} fileName={`comercial-campanhas-${period.from}-${period.to}`} empty="Nenhum lead de campanha no período."
        note="Leads que entraram no período. Investimento é o total lançado na campanha; o retorno compara o faturamento dos pacientes convertidos com o investimento."
        columns={[
          { label: 'Campanha', value: (row) => row.name },
          { label: 'Canal', value: (row) => row.source_name },
          { label: 'Investimento', value: (row) => row.budget, format: 'money', total: true },
          { label: 'Leads', value: (row) => row.leads, format: 'int', total: true },
          { label: 'Convertidos', value: (row) => row.converted, format: 'int', total: true },
          { label: 'Custo por lead', value: (row) => (row.leads ? row.budget / row.leads : null), format: 'money' },
          { label: 'Custo por paciente', value: (row) => (row.converted ? row.budget / row.converted : null), format: 'money' },
          ...(money ? [
            { label: 'Faturamento', value: (row: CampaignReportRow) => row.revenue, format: 'money' as const, total: true as const },
            { label: 'Retorno', value: roi, format: 'pct' as const }
          ] : [])
        ]} />

      <div className="finance-split">
        <ReportTable title="Etapas" rows={summary.stages} fileName={`comercial-etapas-${period.from}-${period.to}`} empty="Sem etapas."
          columns={[
            { label: 'Etapa', value: (row) => row.name },
            { label: 'Leads', value: (row) => row.count, format: 'int', total: true },
            { label: 'Participação', value: (row) => ratio(row.count, summary.leads), format: 'pct' }
          ]} />
        <ReportTable title="Motivos de perda" rows={summary.loss_reasons} fileName={`comercial-perdas-${period.from}-${period.to}`} empty="Nenhuma perda no período."
          columns={[
            { label: 'Motivo', value: (row) => row.name },
            { label: 'Leads', value: (row) => row.count, format: 'int', total: true },
            { label: 'Participação', value: (row) => ratio(row.count, summary.lost), format: 'pct' }
          ]} />
      </div>
    </>
  );
}
