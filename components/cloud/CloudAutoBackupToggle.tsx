/**
 * Toggle „Backup automat iCloud" + hint când iCloud Drive e indisponibil.
 *
 * Extras din `app/cloud-backup.tsx`.
 */
import { Platform, StyleSheet, Switch, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary, onPrimary } from '@/theme/colors';
import { radius } from '@/theme/layout';

interface CloudAutoBackupToggleProps {
  scheme: 'light' | 'dark';
  enabled: boolean;
  available: boolean;
  loading: boolean;
  onToggle: (value: boolean) => void;
}

export function CloudAutoBackupToggle({
  scheme,
  enabled,
  available,
  loading,
  onToggle,
}: CloudAutoBackupToggleProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={[styles.label, { color: C.text }]}>Backup automat iCloud</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            Sincronizează automat manifestul și fișierele când app-ul intră în fundal.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          disabled={loading}
          trackColor={{ false: C.border, true: primary }}
          thumbColor={onPrimary}
        />
      </View>
      {!available ? (
        <Text style={[styles.hint, { color: C.textSecondary }]}>
          iCloud Drive nu este disponibil pe acest dispozitiv. Activează-l din Setările
          telefonului.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1 },
  label: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 8, opacity: 0.8 },
});
