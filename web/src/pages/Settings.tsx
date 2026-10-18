import { api } from '../api.ts';
import { Field } from '../components/Modal.tsx';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { useToast } from '../components/Toast.tsx';
import { text, useFormSubmit, useLoad } from '../hooks.ts';

const whole = (value: string, min: number, max: number, label: string) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label}: informe um número entre ${min} e ${max}.`);
  return number;
};

// Configurações da clínica (permissão settings.manage): prazo do prontuário e política de cobrança.
export function SettingsPage() {
  const notify = useToast();
  const { data, error, reload } = useLoad(api.settings, []);
  const record = useFormSubmit(async (form) => {
    await api.updateSettings({ note_deadline_hours: whole(text(form, 'hours'), 1, 720, 'Prazo') });
    notify('Configurações salvas.');
    reload();
  });
  const billing = useFormSubmit(async (form) => {
    await api.updateSettings({
      missed_charge_percent: whole(text(form, 'missed'), 0, 100, 'Falta'),
      late_cancel_hours: whole(text(form, 'lateHours'), 0, 168, 'Antecedência'),
      late_cancel_charge_percent: whole(text(form, 'latePercent'), 0, 100, 'Cancelamento tardio')
    });
    notify('Política de cobrança salva.');
    reload();
  });

  if (!data) return <><Heading title="Configurações" /><PanelState error={error} loading={!error} empty="" /></>;

  return (
    <>
      <Heading title="Configurações" lead="Regras gerais da clínica." />
      <Panel title="Prontuário">
        <form className="panel-body form-grid" onSubmit={record.onSubmit} key={`p${data.note_deadline_hours}`}>
          <Field label="Prazo para finalizar a evolução (horas após o fim da sessão)">
            <input className="input" name="hours" type="number" min={1} max={720} required defaultValue={data.note_deadline_hours} />
          </Field>
          <p className="muted small full">Depois do prazo, a sessão aparece como atrasada no controle de prontuários e no painel; evoluções finalizadas depois dele ficam como &ldquo;finalizado fora do prazo&rdquo;.</p>
          {record.error && <p className="erro full" role="alert">{record.error}</p>}
          <div className="full"><button type="submit" className="button" disabled={record.busy}>{record.busy ? 'Salvando…' : 'Salvar'}</button></div>
        </form>
      </Panel>
      <Panel title="Política de cobrança">
        <form className="panel-body form-grid" onSubmit={billing.onSubmit}
          key={`c${data.missed_charge_percent}-${data.late_cancel_hours}-${data.late_cancel_charge_percent}`}>
          <Field label="Falta: % do valor da sessão cobrado">
            <input className="input" name="missed" type="number" min={0} max={100} required defaultValue={data.missed_charge_percent} />
          </Field>
          <span />
          <Field label="Cancelamento pelo paciente com menos de (horas)">
            <input className="input" name="lateHours" type="number" min={0} max={168} required defaultValue={data.late_cancel_hours} />
          </Field>
          <Field label="… cobra este % do valor">
            <input className="input" name="latePercent" type="number" min={0} max={100} required defaultValue={data.late_cancel_charge_percent} />
          </Field>
          <p className="muted small full">A cobrança é criada sozinha quando a sessão é marcada como realizada (100%), falta ou cancelamento tardio (percentuais acima). Cancelamento pela clínica não gera cobrança. Mudanças valem para as próximas marcações.</p>
          {billing.error && <p className="erro full" role="alert">{billing.error}</p>}
          <div className="full"><button type="submit" className="button" disabled={billing.busy}>{billing.busy ? 'Salvando…' : 'Salvar política'}</button></div>
        </form>
      </Panel>
    </>
  );
}
