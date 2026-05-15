/**
 * Card pentru setările de criptare backup iCloud: toggle + buton „Schimbă parola"
 * (apare doar când criptarea e activă).
 *
 * Extras din `app/cloud-backup.tsx`.
 */
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { primary, onPrimary } from '@/theme/colors';
import { radius } from '@/theme/layout';

interface EncryptionSettingsCardProps {
  scheme: 'light' | 'dark';
  enabled: boolean;
  loaded: boolean;
  onToggle: (value: boolean) => void;
  onChangePassword: () => void;
}

export function EncryptionSettingsCard({
  scheme,
  enabled,
  loaded,
  onToggle,
  onChangePassword,
}: EncryptionSettingsCardProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
      <View style={styles.toggleRow}>
        <View style={styles.toggleTextWrap}>
          <Text style={[styles.label, { color: C.text }]}>Criptează backup-ul cu parolă</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            Doar tu poți decripta. Dacă uiți parola, datele sunt pierdute.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={onToggle}
          disabled={!loaded}
          trackColor={{ false: C.border, true: primary }}
          thumbColor={onPrimary}
        />
      </View>
      {enabled ? (
        <Pressable
          onPress={onChangePassword}
          style={({ pressed }) => [
            styles.btn,
            { borderColor: primary, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="key-outline" size={18} color={primary} />
          <Text style={[styles.btnText, { color: primary }]}>Schimbă parola</Text>
        </Pressable>
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleTextWrap: { flex: 1 },
  label: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: 12,
    marginTop: 12,
  },
  btnText: { fontSize: 15, fontWeight: '600' },
});
