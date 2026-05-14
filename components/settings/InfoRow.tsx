import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';

export interface InfoRowProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  iconBg: string;
  iconColor: string;
  label: string;
  sub?: string;
  onPress?: () => void;
  isLast?: boolean;
  scheme: 'light' | 'dark';
}

/**
 * Rând standard în secțiunile de Setări — icon colorat + label + opțional sub-text
 * + chevron dacă e clickable. Folosit de toate sub-componentele Settings.
 */
export function InfoRow({
  icon,
  iconBg,
  iconColor,
  label,
  sub,
  onPress,
  isLast,
  scheme,
}: InfoRowProps) {
  const C = Colors[scheme];
  return (
    <Pressable
      style={({ pressed }) => [
        isLast ? styles.rowLast : styles.row,
        { borderBottomColor: C.border },
        pressed && onPress && { opacity: 0.7 },
      ]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.rowLeft}>
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={18} color={iconColor} />
        </View>
        <View style={styles.rowLabelWrap}>
          <Text style={[styles.rowLabel, { color: C.text }]}>{label}</Text>
          {sub ? <Text style={[styles.rowSub, { color: C.textSecondary }]}>{sub}</Text> : null}
        </View>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowLabelWrap: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 1, lineHeight: 16 },
});
