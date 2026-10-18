import { router } from 'expo-router';
import { useState } from 'react';
import { patientStatusLabel } from '../../../../shared/format.ts';
import { Card, Field, Row, Screen, State } from '../../components/ui';
import { api } from '../../lib/supabase';
import { useLoad, useReloadOnFocus } from '../../lib/useLoad';

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Busca de pacientes (quem vê todos, ou a profissional com a própria carteira).
export default function Patients() {
  const { data, error, loading, reload } = useLoad(api.patients, []);
  useReloadOnFocus(reload);
  const [search, setSearch] = useState('');
  const term = normalize(search.trim());
  const digits = search.replace(/\D/g, '');
  const patients = (data ?? []).filter((item) => !term || normalize(item.name).includes(term) || normalize(item.social_name ?? '').includes(term)
    || (digits.length >= 4 && (item.phone ?? '').replace(/\D/g, '').includes(digits))).slice(0, 100);
  return (
    <Screen refreshing={loading} onRefresh={reload}>
      <Field label="Buscar por nome ou telefone" value={search} onChangeText={setSearch} autoCorrect={false} />
      <State error={error} loading={!data && loading} empty={data && !patients.length ? 'Nenhum paciente encontrado.' : undefined} />
      {patients.length > 0 && (
        <Card>
          {patients.map((item) => (
            <Row key={item.id} title={item.social_name || item.name} detail={[item.phone, item.status !== 'active' ? patientStatusLabel[item.status] : null].filter(Boolean).join(' · ')}
              onPress={() => router.push(`/paciente/${item.id}`)} />
          ))}
        </Card>
      )}
    </Screen>
  );
}
