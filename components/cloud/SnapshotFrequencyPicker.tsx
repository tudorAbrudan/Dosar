/**
 * List-radio pentru alegerea frecvenței snapshot-urilor cloud:
 * dezactivat / zilnic / la 3 zile / săptămânal / lunar.
 *
 * Extras din `app/cloud-backup.tsx`.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import type { SnapshotFrequency } from '@/types';

const OPTIONS: { value: SnapshotFrequency; label: string }[] = [
  { value: 'off', label: 'Dezactivat' },
  { value: 'daily', label: 'Zilnic' },
  { value: 'every3days', label: 'La 3 zile' },
  { value: 'weekly', label: 'Săptămânal' },
  { value: 'monthly', label: 'Lunar' },
];

interface SnapshotFrequencyPickerProps {
  scheme: 'light' | 'dark';
  value: SnapshotFrequency;
  loading: boolean;
  onChange: (value: SnapshotFrequency) => void;
}

export function SnapshotFrequencyPicker({
  scheme,
  value,
  loading,
  onChange,
}: SnapshotFrequencyPickerProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
      {loading ? (
        <View style={styles.skeleton}>
          <ActivityIndicator size="small" color={primary} />
        </View>
      ) : (
        OPTIONS.map((opt, idx) => {
          const selected = value === opt.value;
          const isLast = idx === OPTIONS.length - 1;
          return (
            <Pressable
              key={opt.value}
              onPress={() => onChange(opt.value)}
              style={({ pressed }) => [
                styles.row,
                !isLast && {
                  borderBottomColor: C.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.label, { color: C.text }]}>{opt.label}</Text>
              {selected ? <Ionicons name="checkmark" size={20} color={primary} /> : null}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    paddingHorizontal: 16,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    marginBottom: 12,
  },
  skeleton: { paddingVertical: 16, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  label: { fontSize: 15 },
});
