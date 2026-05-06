import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary } from '@/theme/colors';
import { formatBytes, type RestoreProgress } from '@/services/cloudSync';

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

  // Pentru faza `files` preferăm progresul în bytes — userul vrea să vadă cât a
  // descărcat din total. Cădem pe count dacă bytesTotal = 0 (manifest gol sau
  // toate fișierele deja existente local).
  const useBytes = progress.phase === 'files' && progress.bytesTotal > 0;
  const pct = useBytes
    ? Math.round((progress.bytesDone / progress.bytesTotal) * 100)
    : progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;
  const detail =
    progress.phase === 'files'
      ? useBytes
        ? `${progress.current} / ${progress.total} fișiere · ${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
        : `${progress.current} / ${progress.total} fișiere`
      : '';

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
