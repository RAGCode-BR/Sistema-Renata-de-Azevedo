import Ionicons from '@expo/vector-icons/Ionicons';
import type { ColorValue } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { useTheme } from '../../lib/theme';

type Icon = keyof typeof Ionicons.glyphMap;
const icon = (name: Icon) => ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;

export default function TabsLayout() {
  const theme = useTheme();
  const { user } = useAuth();
  if (!user) return <Redirect href="/login" />;
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: theme.primary, tabBarInactiveTintColor: theme.muted,
      tabBarStyle: { backgroundColor: theme.card, borderTopColor: theme.border },
      headerStyle: { backgroundColor: theme.card }, headerTitleStyle: { color: theme.text }, sceneStyle: { backgroundColor: theme.background }
    }}>
      <Tabs.Screen name="index" options={{ title: 'Início', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="agenda" options={{ title: 'Agenda', tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="pacientes" options={{ title: 'Pacientes', tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="tarefas" options={{ title: 'Tarefas', tabBarIcon: icon('checkbox-outline') }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais', tabBarIcon: icon('ellipsis-horizontal-circle-outline') }} />
    </Tabs>
  );
}
