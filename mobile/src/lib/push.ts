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
    // AndroidImportance é reexportado por export * (o TypeScript confere); o lint não acompanha.
    // eslint-disable-next-line import/namespace
    await Notifications.setNotificationChannelAsync('default', { name: 'Avisos', importance: Notifications.AndroidImportance.HIGH, lightColor: '#53102F' });
  }
  const current = await Notifications.getPermissionsAsync();
  const granted = current.status === 'granted' || (await Notifications.requestPermissionsAsync()).status === 'granted';
  if (!granted) return null;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await api.registerPushDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return token;
}

// Avisos antigos de pendências ficam na lista de avisos.
export function routeForLink(link: string | null | undefined): string {
  if (link === '#/tarefas') return '/(tabs)/tarefas';
  return '/avisos';
}
