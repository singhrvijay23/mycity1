import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewProps, useColorScheme } from 'react-native';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return dark
    ? { bg: '#111312', card: '#1b1e1d', text: '#ececea', muted: '#9ca3af', line: '#2c302e', brand: '#2dd4bf', brandInk: '#062a26', soft: '#123c37', danger: '#f87171' }
    : { bg: '#f7f7f5', card: '#ffffff', text: '#1c1917', muted: '#6b7280', line: '#e7e5e4', brand: '#0f766e', brandInk: '#ffffff', soft: '#ccfbf1', danger: '#b91c1c' };
}

export function T({ style, muted, small, bold, ...p }: React.ComponentProps<typeof Text> & { muted?: boolean; small?: boolean; bold?: boolean }) {
  const t = useTheme();
  return <Text {...p} style={[{ color: muted ? t.muted : t.text, fontSize: small ? 13 : 15 }, bold && { fontWeight: '700' }, style]} />;
}
export function H({ children }: { children: React.ReactNode }) {
  return <T style={{ fontSize: 22, fontWeight: '800', marginBottom: 12 }}>{children}</T>;
}
export function Card({ style, ...p }: ViewProps) {
  const t = useTheme();
  return <View {...p} style={[{ backgroundColor: t.card, borderColor: t.line, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 10 }, style]} />;
}
export function Btn({ title, onPress, ghost, disabled, loading }: { title: string; onPress: () => void; ghost?: boolean; disabled?: boolean; loading?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [s.btn, { backgroundColor: ghost ? 'transparent' : t.brand, borderColor: t.brand, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}>
      {loading ? <ActivityIndicator color={ghost ? t.brand : t.brandInk} /> : <Text style={{ color: ghost ? t.brand : t.brandInk, fontWeight: '700' }}>{title}</Text>}
    </Pressable>
  );
}
export function Field({ label, ...p }: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 12 }}>
      <T small bold style={{ marginBottom: 4 }}>{label}</T>
      <TextInput placeholderTextColor={t.muted} {...p}
        style={[{ borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 10, color: t.text, backgroundColor: t.card }, p.multiline && { minHeight: 90, textAlignVertical: 'top' }]} />
    </View>
  );
}
export function Pill({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={{ backgroundColor: t.soft, color: t.text, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2, fontSize: 12, fontWeight: '700', overflow: 'hidden', alignSelf: 'flex-start' }}>{text}</Text>;
}
export function Err({ msg }: { msg?: string }) {
  const t = useTheme();
  return msg ? <Text style={{ color: t.danger, marginVertical: 6 }}>{msg}</Text> : null;
}
const s = StyleSheet.create({ btn: { paddingVertical: 12, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, alignItems: 'center', marginVertical: 4 } });
