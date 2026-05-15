/**
 * Picker pentru reguli de auto-ștergere a unui document — chips orizontale
 * cu opțiunile din `RETENTION_OPTIONS` plus „La expirare" condiționat de
 * prezența unei date de expirare.
 *
 * Folosit identic în `documente/add.tsx` și `documente/edit.tsx`.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { RETENTION_OPTIONS, retentionLabel } from '@/services/documentRetention';

interface AutoDeletePickerProps {
  value: string | null;
  hasExpiryDate: boolean;
  scheme: 'light' | 'dark';
  onChange: (value: string | null) => void;
}

interface RetentionChoice {
  label: string;
  value: string | null;
}

export function AutoDeletePicker({
  value,
  hasExpiryDate,
  scheme,
  onChange,
}: AutoDeletePickerProps) {
  const C = Colors[scheme];
  const options: RetentionChoice[] = [
    ...(hasExpiryDate ? [{ label: 'La expirare', value: 'expiry' } as RetentionChoice] : []),
    ...RETENTION_OPTIONS,
  ];

  return (
    <View>
      <Text style={[styles.label, { color: C.text }]}>
        {'Auto-ștergere (opțional)'}
        {value !== null ? `: ${retentionLabel(value)}` : ''}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {options.map(opt => {
          const active = value === opt.value;
          return (
            <Pressable
              key={opt.value ?? 'never'}
              style={[
                styles.chip,
                { borderColor: C.border },
                active && styles.chipActive,
              ]}
              onPress={() => onChange(opt.value)}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: C.text },
                  active && styles.chipTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, opacity: 0.7, marginTop: 14, marginBottom: 6 },
  chipsRow: { paddingVertical: 2, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: primary, borderColor: primary },
  chipText: { fontSize: 13 },
  // Text peste fundal primary (verde) — alb pe ambele teme, theme-neutral.
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  chipTextActive: { color: '#fff', fontWeight: '600' },
});
