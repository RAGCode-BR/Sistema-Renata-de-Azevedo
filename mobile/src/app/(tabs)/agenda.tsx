import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { can } from '../../../../shared/permissions.ts';
import { occupiesSlot } from '../../../../shared/types.ts';
import { addDays, dateKey, startOfToday, statusLabel, time } from '../../../../shared/format.ts';
import { Card, Muted, Row, Screen, State, Tabs } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/supabase';
import { useTheme } from '../../lib/theme';
import { useLoad, useReloadOnFocus } from '../../lib/useLoad';

type View_ = 'dia' | 'semana';

// Agenda por dia ou semana. Quem vê a agenda geral escolhe a profissional; a profissional vê a própria.
export default function Agenda() {
  const theme = useTheme();
  const { user } = useAuth();
  const overview = can(user!, 'appointments.view_all');
  const [view, setView] = useState<View_>('dia');
  const [anchor, setAnchor] = useState(startOfToday());
  const [professional, setProfessional] = useState<string>('');
  const days = view === 'dia' ? 1 : 7;
  const from = view === 'dia' ? anchor : addDays(anchor, -((anchor.getDay() + 6) % 7));
  const { data, error, loading, reload } = useLoad(() => Promise.all([api.appointments(from, addDays(from, days)), api.professionals()]),
    [dateKey(from), days]);
  useReloadOnFocus(reload);
  const [appointments = [], professionals = []] = data ?? [];
  const shown = appointments.filter((item) => occupiesSlot(item.status) && (!professional || item.professional_id === professional));
  const byDay = Array.from({ length: days }, (_, index) => addDays(from, index))
    .map((day) => ({ day, items: shown.filter((item) => dateKey(new Date(item.starts_at)) === dateKey(day)) }));

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Tabs value={view} onChange={setView} options={[['dia', 'Dia'], ['semana', 'Semana']]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Anterior" onPress={() => setAnchor(addDays(anchor, -days))} style={{ padding: 10 }}>
          <Text style={{ color: theme.primary, fontSize: 20 }}>‹</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setAnchor(startOfToday())}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>
            {view === 'dia' ? from.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
              : `${from.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })} a ${addDays(from, 6).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`}
          </Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Próximo" onPress={() => setAnchor(addDays(anchor, days))} style={{ padding: 10 }}>
          <Text style={{ color: theme.primary, fontSize: 20 }}>›</Text></Pressable>
      </View>
      {overview && professionals.length > 1 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {[{ id: '', name: 'Todas' }, ...professionals.filter((item) => item.active)].map((item) => (
            <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ selected: professional === item.id }} onPress={() => setProfessional(item.id)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: professional === item.id ? theme.primary : theme.soft }}>
              <Text style={{ color: professional === item.id ? theme.onPrimary : theme.primary, fontSize: 13 }}>{item.name.split(' ')[0]}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <State error={error} loading={!data && loading} />
      {data && byDay.map(({ day, items }) => (
        <Card key={dateKey(day)} title={view === 'semana' ? day.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) : undefined}>
          {!items.length && <Muted>Nenhuma sessão.</Muted>}
          {items.map((item) => (
            <Row key={item.id} title={`${time(item.starts_at)} · ${item.patient_name}`}
              detail={`${overview && !professional ? `${item.professional_name} · ` : ''}${statusLabel[item.status]}${item.modality === 'online' ? ' · on-line' : ''}`}
              tone={item.status === 'confirmed' ? 'success' : item.status === 'awaiting_confirmation' ? 'warning' : undefined}
              onPress={() => router.push(`/sessao/${item.id}`)} />
          ))}
        </Card>
      ))}
    </Screen>
  );
}
