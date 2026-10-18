import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Guarda a sessão no cofre do aparelho (Keychain no iOS, Keystore no Android). Valores grandes são
// divididos em partes, porque alguns sistemas recusam itens acima de ~2 KB. No navegador (só usado
// em testes) vai para o localStorage.
const PART = 1800;
const web = Platform.OS === 'web';
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (web) return globalThis.localStorage?.getItem(key) ?? null;
    const count = Number(await SecureStore.getItemAsync(`${safe(key)}.partes`));
    if (!count) return null;
    const parts = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(`${safe(key)}.${index}`)));
    return parts.some((part) => part === null) ? null : parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    if (web) { globalThis.localStorage?.setItem(key, value); return; }
    await this.removeItem(key);
    const parts = value.match(new RegExp(`[\\s\\S]{1,${PART}}`, 'g')) ?? [''];
    await Promise.all(parts.map((part, index) => SecureStore.setItemAsync(`${safe(key)}.${index}`, part, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })));
    await SecureStore.setItemAsync(`${safe(key)}.partes`, String(parts.length), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  async removeItem(key: string): Promise<void> {
    if (web) { globalThis.localStorage?.removeItem(key); return; }
    const count = Number(await SecureStore.getItemAsync(`${safe(key)}.partes`));
    await Promise.all(Array.from({ length: count || 0 }, (_, index) => SecureStore.deleteItemAsync(`${safe(key)}.${index}`)));
    await SecureStore.deleteItemAsync(`${safe(key)}.partes`);
  }
};
