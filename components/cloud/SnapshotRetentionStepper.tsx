/**
 * Stepper +/- pentru numărul de snapshot-uri păstrate în cloud, cu limite
 * [1, 20]. Folosit în `app/cloud-backup.tsx`.
 */
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';

const MIN_RETENTION = 1;
const MAX_RETENTION = 20;

interface SnapshotRetentionStepperProps {
  scheme: 'light' | 'dark';
  value: number;
  loading: boolean;
  onChange: (delta: number) => void;
}

export function SnapshotRetentionStepper({
  scheme,
  value,
  loading,
  onChange,
}: SnapshotRetentionStepperProps) {
  const C = Colors[scheme];
  if (loading) {
    return (
      <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
        <View style={styles.skeleton}>
          <ActivityIndicator size="small" color={primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
      <View style={styles.row}>
        <Text style={[styles.label, { color: C.text }]}>Păstrează ultimele</Text>
        <View style={styles.stepperRow}>
          <Pressable
            onPress={() => onChange(-1)}
            disabled={value <= MIN_RETENTION}
            style={({ pressed }) => [
              styles.btn,
              { borderColor: C.border },
              pressed && { opacity: 0.6 },
              value <= MIN_RETENTION && { opacity: 0.4 },
            ]}
            hitSlop={8}
          >
            <Ionicons name="remove" size={18} color={C.text} />
          </Pressable>
          <Text style={[styles.count, { color: C.text }]}>{value}</Text>
          <Pressable
            onPress={() => onChange(1)}
            disabled={value >= MAX_RETENTION}
            style={({ pressed }) => [
              styles.btn,
              { borderColor: C.border },
              pressed && { opacity: 0.6 },
              value >= MAX_RETENTION && { opacity: 0.4 },
            ]}
            hitSlop={8}
          >
            <Ionicons name="add" size={18} color={C.text} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    marginBottom: 12,
  },
  skeleton: { paddingVertical: 4, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 16, fontWeight: '600' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  btn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: { fontSize: 16, fontWeight: '600', minWidth: 24, textAlign: 'center' },
});
