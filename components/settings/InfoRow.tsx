import { View, Text, Pressable, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, onPrimary, statusColors } from '@/theme/colors';

export interface InfoRowProps {
  /** Iconița din pătratul colorat; `emoji` o înlocuiește (tipurile de entități). */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  emoji?: string;
  iconBg: string;
  iconColor: string;
  label: string;
  sub?: string;
  /** Etichetă roșie, pentru acțiuni care șterg date. */
  destructive?: boolean;
  /** Rândul întreg e apăsabil; în dreapta apare săgeata. */
  onPress?: () => void;
  /** Rând care deschide un panou dedesubt: săgeată sus/jos în loc de săgeata spre dreapta. */
  expanded?: boolean;
  /** Rotiță în locul săgeții cât rulează acțiunea rândului. */
  busy?: boolean;
  /** Comutator în dreapta (rândul în sine nu e apăsabil, ca în Setările iOS). */
  switchValue?: boolean;
  onSwitchChange?: (value: boolean) => void;
  /** Text scurt în dreapta (ex. versiunea). */
  value?: string;
  /** Alt control în dreapta (câmp numeric, buton de ștergere). */
  right?: React.ReactNode;
  accessibilityHint?: string;
  scheme: 'light' | 'dark';
}

/**
 * Rândul standard din Setări: pătrat colorat cu iconiță, etichetă, subtext opțional și un
 * singur element în dreapta (săgeată, comutator, valoare sau control propriu).
 * Liniile dintre rânduri le pune `SectionCard`.
 */
export function InfoRow({
  icon,
  emoji,
  iconBg,
  iconColor,
  label,
  sub,
  destructive,
  onPress,
  expanded,
  busy,
  switchValue,
  onSwitchChange,
  value,
  right,
  accessibilityHint,
  scheme,
}: InfoRowProps) {
  const C = Colors[scheme];
  const hasSwitch = switchValue !== undefined && onSwitchChange !== undefined;

  let trailing: React.ReactNode = null;
  if (busy) {
    trailing = <ActivityIndicator size="small" color={C.textSecondary} />;
  } else if (hasSwitch) {
    trailing = (
      <Switch
        value={switchValue}
        onValueChange={onSwitchChange}
        trackColor={{ false: C.border, true: primary }}
        thumbColor={onPrimary}
        style={styles.switch}
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
      />
    );
  } else if (right) {
    trailing = right;
  } else if (value) {
    trailing = <Text style={[styles.value, { color: C.textSecondary }]}>{value}</Text>;
  } else if (onPress) {
    const chevron =
      expanded === undefined ? 'chevron-forward' : expanded ? 'chevron-up' : 'chevron-down';
    trailing = <Ionicons name={chevron} size={16} color={C.textSecondary} />;
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]}
      onPress={onPress}
      disabled={!onPress || busy}
      // Fără onPress rândul nu grupează: comutatorul/controlul din dreapta rămâne focusabil separat.
      accessible={!!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? (sub ? `${label}. ${sub}` : label) : undefined}
      accessibilityHint={onPress ? accessibilityHint : undefined}
      accessibilityState={onPress ? { expanded, busy } : undefined}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        {emoji ? (
          <Text style={styles.emoji}>{emoji}</Text>
        ) : icon ? (
          <Ionicons name={icon} size={18} color={iconColor} />
        ) : null}
      </View>
      <View style={styles.rowLabelWrap}>
        <Text style={[styles.rowLabel, { color: destructive ? statusColors.critical : C.text }]}>
          {label}
        </Text>
        {sub ? <Text style={[styles.rowSub, { color: C.textSecondary }]}>{sub}</Text> : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  pressed: { opacity: 0.7 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  emoji: { fontSize: 16 },
  rowLabelWrap: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 1, lineHeight: 16 },
  value: { fontSize: 13, fontWeight: '500' },
  // Switch-ul iOS vine cu alignSelf: 'flex-start' (RN): fără asta stă sus la rândurile pe 2+ linii.
  switch: { alignSelf: 'center' },
});
