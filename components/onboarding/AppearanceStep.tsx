/**
 * Pasul APPEARANCE din OnboardingWizard — chips pentru tema de culori
 * (Automat / Clar / Întunecat).
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary, onPrimary } from '@/theme/colors';
import { radius } from '@/theme/layout';

type ThemePref = 'auto' | 'light' | 'dark';

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'auto', label: 'Automat' },
  { value: 'light', label: 'Clar' },
  { value: 'dark', label: 'Întunecat' },
];

interface AppearanceStepProps {
  scheme: 'light' | 'dark';
  value: ThemePref;
  onChange: (value: ThemePref) => void;
}

export function AppearanceStep({ scheme, value, onChange }: AppearanceStepProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Text style={[styles.label, { color: C.text }]}>Temă de culori</Text>
      <View style={styles.chipRow}>
        {OPTIONS.map(opt => {
          const active = value === opt.value;
          return (
            <Pressable
              key={opt.value}
              style={[
                styles.chip,
                active
                  ? [styles.chipActive, { borderColor: C.primary }]
                  : { borderColor: C.border, backgroundColor: C.background },
              ]}
              onPress={() => onChange(opt.value)}
            >
              <Text style={[styles.chipText, { color: active ? onPrimary : C.text }]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.sub, { color: C.textSecondary }]}>
        „Automat" urmărește setarea telefonului.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  label: { fontSize: 16, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  chipActive: { backgroundColor: primary },
  chipText: { fontSize: 13, fontWeight: '500' },
  sub: { fontSize: 13, marginTop: 12, lineHeight: 18 },
});
