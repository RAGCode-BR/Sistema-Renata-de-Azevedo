import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';

// Peças de tela do app (mesma linguagem visual do sistema web, em componentes nativos).

export function Screen({ children, refreshing, onRefresh, scroll = true }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean;
}) {
  const theme = useTheme();
  const body = <View style={styles.body}>{children}</View>;
  return (
    <SafeAreaView edges={['left', 'right']} style={{ flex: 1, backgroundColor: theme.background }}>
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={theme.primary} /> : undefined}>
          {body}
        </ScrollView>
      ) : body}
    </SafeAreaView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{children}</Text>
      {sub ? <Text style={{ color: theme.muted, fontSize: 14, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

export function Card({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
      {title ? (
        <View style={styles.cardHead}>
          <Text accessibilityRole="header" style={[styles.cardTitle, { color: theme.text }]}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20 }}>{children}</Text>;
}

export function Body({ children, danger }: { children: ReactNode; danger?: boolean }) {
  const theme = useTheme();
  return <Text style={{ color: danger ? theme.danger : theme.text, fontSize: 15, lineHeight: 21 }}>{children}</Text>;
}

export function Button({ label, onPress, variant = 'primary', disabled, busy }: {
  label: string; onPress: () => void; variant?: 'primary' | 'light' | 'danger'; disabled?: boolean; busy?: boolean;
}) {
  const theme = useTheme();
  const bg = variant === 'primary' ? theme.primary : variant === 'danger' ? theme.danger : theme.soft;
  const fg = variant === 'light' ? theme.primary : theme.onPrimary;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: theme.muted, fontSize: 13, marginBottom: 4 }}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={theme.muted} {...props}
        style={[styles.input, { color: theme.text, backgroundColor: theme.field, borderColor: theme.border }, props.multiline && { minHeight: 120, textAlignVertical: 'top' }, props.style]} />
    </View>
  );
}

// Linha de lista tocável: título, detalhe e um selo/valor à direita.
export function Row({ title, detail, right, onPress, tone }: {
  title: string; detail?: string; right?: ReactNode; onPress?: () => void; tone?: 'danger' | 'warning' | 'success';
}) {
  const theme = useTheme();
  const color = tone ? theme[tone] : theme.text;
  const content = (
    <View style={[styles.row, { borderColor: theme.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color, fontSize: 15, fontWeight: '500' }}>{title}</Text>
        {detail ? <Text style={{ color: theme.muted, fontSize: 13, marginTop: 2 }}>{detail}</Text> : null}
      </View>
      {typeof right === 'string' ? <Text style={{ color: theme.muted, fontSize: 13 }}>{right}</Text> : right}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>{content}</Pressable> : content;
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (value: T) => void }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: theme.soft }]}>
      {options.map(([key, label]) => (
        <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: value === key }} onPress={() => onChange(key)}
          style={[styles.tab, value === key && { backgroundColor: theme.card }]}>
          <Text style={{ color: value === key ? theme.primary : theme.muted, fontWeight: value === key ? '600' : '400', fontSize: 14 }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Stat({ value, label, tone }: { value: string; label: string; tone?: 'danger' }) {
  const theme = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <Text style={{ color: tone ? theme.danger : theme.primary, fontSize: 22, fontWeight: '600' }}>{value}</Text>
      <Text style={{ color: theme.muted, fontSize: 13 }}>{label}</Text>
    </View>
  );
}

export function State({ error, loading, empty }: { error?: string; loading?: boolean; empty?: string }) {
  const theme = useTheme();
  if (error) return <Text accessibilityRole="alert" style={{ color: theme.danger, padding: 8 }}>{error}</Text>;
  if (loading) return <ActivityIndicator style={{ padding: 16 }} color={theme.primary} />;
  return empty ? <Text style={{ color: theme.muted, padding: 8 }}>{empty}</Text> : null;
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingTop: 12 },
  title: { fontSize: 26, fontWeight: '600' },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, marginBottom: 14 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  button: { minHeight: 46, borderRadius: 999, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { flexDirection: 'row', borderRadius: 999, padding: 4, marginBottom: 12, alignSelf: 'flex-start' },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  stat: { flexGrow: 1, flexBasis: '45%', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12 }
});
