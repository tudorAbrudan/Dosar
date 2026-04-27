import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary } from '@/theme/colors';
import type { RestoreProgress } from '@/services/cloudSync';

interface Props {
  progress: RestoreProgress | null;
}

const PHASE_LABELS: Record<RestoreProgress['phase'], string> = {
  manifest: 'Descarc manifestul...',
  files: 'Descarc fișierele',
  apply: 'Aplic datele...',
  done: 'Gata',
};

export function CloudRestoreProgress({ progress }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  if (!progress) return null;

  const pct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const detail = progress.phase === 'files' ? `${progress.current} / ${progress.total}` : '';

  return (
    <View style={[styles.wrap, { backgroundColor: palette.surface }]}>
      <ActivityIndicator color={primary} size="large" />
      <Text style={[styles.label, { color: palette.text }]}>{PHASE_LABELS[progress.phase]}</Text>
      {!!detail && <Text style={[styles.detail, { color: palette.textSecondary }]}>{detail}</Text>}
      <View style={[styles.barWrap, { backgroundColor: palette.border }]}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: primary }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    margin: 16,
  },
  label: { fontSize: 16, fontWeight: '600' },
  detail: { fontSize: 13 },
  barWrap: {
    height: 4,
    width: '100%',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 8,
  },
  barFill: { height: '100%' },
});
