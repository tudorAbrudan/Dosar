/**
 * Card-ul cu acțiunile principale din ecranul Cloud Backup:
 *   - „Backup acum" (primary CTA, cu spinner la upload)
 *   - „Restaurează din iCloud" (outline)
 *
 * Extras din `app/cloud-backup.tsx`.
 */
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { primary, onPrimary } from '@/theme/colors';
import { radius } from '@/theme/layout';

interface CloudActionsCardProps {
  scheme: 'light' | 'dark';
  enabled: boolean;
  available: boolean;
  uploading: boolean;
  restoreInProgress: boolean;
  onBackupNow: () => void;
  onRestore: () => void;
}

export function CloudActionsCard({
  scheme,
  enabled,
  available,
  uploading,
  restoreInProgress,
  onBackupNow,
  onRestore,
}: CloudActionsCardProps) {
  const C = Colors[scheme];
  const backupDisabled = !enabled || !available || uploading;
  const restoreDisabled = !available || restoreInProgress;

  return (
    <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
      <Pressable
        onPress={onBackupNow}
        disabled={backupDisabled}
        style={({ pressed }) => [
          styles.primaryBtn,
          { backgroundColor: primary },
          (pressed || backupDisabled) && { opacity: 0.6 },
        ]}
      >
        {uploading ? (
          <ActivityIndicator size="small" color={onPrimary} />
        ) : (
          <Ionicons name="cloud-upload-outline" size={18} color={onPrimary} />
        )}
        <Text style={[styles.primaryBtnText, { color: onPrimary }]}>
          {uploading ? 'Se sincronizează...' : 'Backup acum'}
        </Text>
      </Pressable>
      <Pressable
        onPress={onRestore}
        disabled={restoreDisabled}
        style={({ pressed }) => [
          styles.outlineBtn,
          { borderColor: primary },
          (pressed || restoreDisabled) && { opacity: 0.6 },
        ]}
      >
        <Ionicons name="cloud-download-outline" size={18} color={primary} />
        <Text style={[styles.outlineBtnText, { color: primary }]}>Restaurează din iCloud</Text>
      </Pressable>
      <Text style={[styles.hint, { color: C.textSecondary }]}>
        Restaurarea înlocuiește toate datele locale cu cele din backup-ul iCloud.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
    marginBottom: 12,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.lg,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700' },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  outlineBtnText: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12, lineHeight: 17, opacity: 0.8 },
});
