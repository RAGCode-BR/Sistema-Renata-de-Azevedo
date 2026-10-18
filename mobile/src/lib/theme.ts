import { useColorScheme } from 'react-native';

// Mesma identidade do sistema (vinho e dourado). O modo escuro segue o celular, com cores próprias
// (vinho claro sobre fundo escuro, para manter o contraste).
const light = {
  background: '#F5EFE7', card: '#FFFFFF', text: '#2C2326', muted: '#6D6266', border: '#ECE4DA',
  primary: '#53102F', onPrimary: '#FFFFFF', soft: '#F5EAEF', gold: '#B98D6C',
  success: '#3F6B55', warning: '#8F6229', danger: '#9A3F45', field: '#FFFFFF'
};
const dark: typeof light = {
  background: '#171113', card: '#221A1D', text: '#F3EAE6', muted: '#B8AAAE', border: '#3A2E32',
  primary: '#E2A9C2', onPrimary: '#2A0C19', soft: '#3A2230', gold: '#D9B48F',
  success: '#8CC7A6', warning: '#E3B46F', danger: '#F09A9F', field: '#2A2024'
};
export type Theme = typeof light;
export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}
