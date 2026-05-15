import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';

export type AiTestStatus = 'idle' | 'loading' | 'ok' | 'error';

interface AiActionBarProps {
  testStatus: AiTestStatus;
  scheme: 'light' | 'dark';
  onSave: () => void;
  onTest: () => void;
}

/**
 * Bară fixă sub header-ul modalului AI: butoanele Salvează (primary) +
 * Testează conexiune (state-aware, schimbă culoare la ok/error).
 */
export function AiActionBar({ testStatus, scheme, onSave, onTest }: AiActionBarProps) {
  const C = Colors[scheme];
  const testColor =
    testStatus === 'ok'
      ? statusColors.ok
      : testStatus === 'error'
        ? statusColors.critical
        : primary;
  const testIcon =
    testStatus === 'ok'
      ? 'checkmark-circle-outline'
      : testStatus === 'error'
        ? 'close-circle-outline'
        : 'wifi-outline';
  const testLabel =
    testStatus === 'loading'
      ? 'Se testează…'
      : testStatus === 'ok'
        ? 'Conexiune OK'
        : testStatus === 'error'
          ? 'Eroare'
          : 'Testează';

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: C.background, borderBottomColor: C.border },
      ]}
    >
      <Pressable
        style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }]}
        onPress={onSave}
        accessibilityLabel="Salvează configurarea AI"
      >
        <Ionicons name="save-outline" size={18} color="#fff" style={styles.btnIcon} />
        <Text style={styles.btnText}>Salvează</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.btnOutline,
          {
            borderColor: testColor,
            opacity: pressed || testStatus === 'loading' ? 0.7 : 1,
          },
        ]}
        onPress={onTest}
        disabled={testStatus === 'loading'}
        accessibilityLabel="Testează conexiunea AI"
      >
        <Ionicons name={testIcon} size={18} color={testColor} style={styles.btnIcon} />
        <Text style={[styles.btnOutlineText, { color: testColor }]}>{testLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 14,
  },
  btnIcon: { marginRight: 8 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 13,
  },
  btnOutlineText: { fontSize: 15, fontWeight: '600' },
});
