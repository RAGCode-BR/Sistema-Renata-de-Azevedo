import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './supabase';

// Push só em aparelho de verdade e com o projeto da Expo configurado (extra.eas.projectId no app.json).
// O texto que chega é genérico; o detalhe aparece dentro do app.
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const projectId = Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId;
  if (!projectId) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Avisos', importance: Notifications.AndroidImportance.HIGH, lightColor: '#53102F' });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.status === 'granted' || (await Notifications.requestPermissionsAsync()).status === 'granted';
  if (!granted) return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.registerPushDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return token;
}

// Link do sistema web (#/tarefas?tarefa=...) para a tela do app.
export function routeForLink(link: string | null | undefined): string {
  const task = link?.match(/tarefa=([0-9a-f-]{36})/)?.[1];
  if (task) return `/tarefa/${task}`;
  return '/avisos';
}
