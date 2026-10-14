import { api } from '../api.ts';
import { Heading, Panel, PanelState } from '../components/Page.tsx';
import { dateTime } from '../format.ts';
import { useLoad } from '../hooks.ts';

export function GoogleCalendarsPage() {
  const { data, error } = useLoad(api.googleCalendars, []);
  const calendars = data ?? [];

  return (
    <>
      <Heading title="Google Agenda" lead="Cada profissional poderá autorizar a própria conta e selecionar mais de um calendário." />

      <p className="notice">
        A estrutura para várias contas e calendários já está no banco local. A conexão OAuth e a sincronização aguardam
        a configuração do aplicativo no Google Cloud; nenhum calendário está conectado ainda.
      </p>

      <Panel title="Calendários vinculados">
        {calendars.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Profissional</th><th>Conta Google</th><th>Calendário</th><th>Sincronizado</th></tr></thead>
              <tbody>
                {calendars.map((item) => (
                  <tr key={item.id}>
                    <td>{item.professional_name}</td>
                    <td>{item.google_email}</td>
                    <td>{item.display_name}</td>
                    <td>{dateTime(item.last_synced_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <PanelState error={error} loading={!data} empty="Nenhum calendário conectado." />}
      </Panel>
    </>
  );
}
