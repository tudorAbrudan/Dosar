/**
 * Banner pe Home: backup-ul iCloud e activat în aplicație, dar iOS nu ne dă
 * containerul (iCloud Drive oprit pe telefon sau pentru Dosar, ori cont
 * delogat). Fără el, backup-ul tace la nesfârșit — starea se vedea doar dacă
 * userul intra singur în ecranul „iCloud Backup" (raportat 2026-07-30).
 *
 * Nu e dismisabil: dispare singur când iCloud Drive revine (hook-ul
 * re-verifică la `AppState → active`).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useColorScheme } from '@/components/useColorScheme';
import { dark, light, statusColors } from '@/theme/colors';

interface Props {
  onPress: () => void;
}

export function CloudDriveOffBanner({ onPress }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.wrap,
        { backgroundColor: palette.surface, borderColor: statusColors.warning },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Ionicons name="cloud-offline-outline" size={22} color={statusColors.warning} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: palette.text }]}>
          Backup-ul iCloud nu funcționează
        </Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          iCloud Drive e oprit pe acest telefon, deci nimic nu se salvează. Atinge pentru pașii de
          reparare.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
    </Pressable>
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
  subtitle: { fontSize: 12, marginTop: 2, lineHeight: 17 },
});
