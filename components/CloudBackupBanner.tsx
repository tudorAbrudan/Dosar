import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, onPrimary } from '@/theme/colors';
import type { CloudManifestMeta } from '@/types';

interface Props {
  meta: CloudManifestMeta;
  onRestore: () => void;
  onDismiss: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'acum';
  if (minutes < 60) return `acum ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `acum ${hours}h`;
  const days = Math.floor(hours / 24);
  return `acum ${days} zile`;
}

export function CloudBackupBanner({ meta, onRestore, onDismiss }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  return (
    <View style={[styles.wrap, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Ionicons name="cloud-download-outline" size={22} color={primary} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: palette.text }]}>Backup mai nou pe iCloud</Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          {meta.documentCount} documente • {formatRelativeTime(meta.uploadedAt)}
        </Text>
      </View>
      <Pressable onPress={onRestore} style={[styles.btn, { backgroundColor: primary }]}>
        <Text style={styles.btnText}>Restaurează</Text>
      </Pressable>
      <Pressable onPress={onDismiss} hitSlop={10}>
        <Ionicons name="close" size={20} color={palette.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  btnText: { color: onPrimary, fontWeight: '600', fontSize: 13 },
});
