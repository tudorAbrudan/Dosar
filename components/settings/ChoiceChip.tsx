import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { primary, onPrimary } from '@/theme/colors';

interface ChoiceChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  scheme: 'light' | 'dark';
}

/** Chip selectabil din Setări (tema din Aspect, tipurile de documente active). */
export function ChoiceChip({
  label,
  selected,
  onPress,
  accessibilityLabel,
  scheme,
}: ChoiceChipProps) {
  const C = Colors[scheme];
  return (
    <Pressable
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.chipSelected : { borderColor: C.border },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
    >
      <Text style={[styles.text, { color: selected ? onPrimary : C.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

/** Rândul care așază chip-urile pe mai multe linii. */
export function ChoiceChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 12 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipSelected: { backgroundColor: primary, borderColor: primary },
  pressed: { opacity: 0.7 },
  text: { fontSize: 13, fontWeight: '500' },
});
