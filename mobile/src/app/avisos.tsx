import { router } from 'expo-router';
import { useEffect } from 'react';
import { dateTime } from '../../../shared/format.ts';
import { Card, Row, Screen, State } from '../components/ui';
import { routeForLink } from '../lib/push';
import { api } from '../lib/supabase';
import { useLoad } from '../lib/useLoad';

// O mesmo sino do sistema: avisos recentes; abrir a tela marca como lido.
export default function Notices() {
  const { data, error, loading, reload } = useLoad(api.notifications, []);
  useEffect(() => { if (data?.some((item) => !item.read_at)) api.markNotificationsRead().catch(() => undefined); }, [data]);
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <State error={error} loading={!data && loading} empty={data && !data.length ? 'Nenhum aviso.' : undefined} />
      {data && data.length > 0 && (
        <Card>
          {data.map((item) => (
            <Row key={item.id} title={item.title} detail={dateTime(item.created_at)} tone={item.read_at ? undefined : 'warning'}
              onPress={() => { const target = routeForLink(item.link); if (target !== '/avisos') router.push(target as never); }} />
          ))}
        </Card>
      )}
    </Screen>
  );
}
