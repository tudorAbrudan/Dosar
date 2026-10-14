import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import type { AiProviderType } from '@/services/aiProvider';

interface AiConsentBarProps {
  providerType: AiProviderType;
  /** Configurația din formular trimite ceva de pe telefon (vezi `aiRouteLeavesDevice`). */
  leavesDevice: boolean;
  checked: boolean;
  scheme: 'light' | 'dark';
  onToggle: () => void;
}

/**
 * Bară fixă cu checkbox pentru acordul de utilizare AI.
 * Apare doar când ceva pleacă de pe telefon — inclusiv modelul local cu citirea
 * pozelor în cloud (până la 2026-10-13 modul local era tratat mereu ca „nimic nu
 * pleacă", deși pozele mergeau la providerul de imagini fără acord).
 */
export function AiConsentBar({
  providerType,
  leavesDevice,
  checked,
  scheme,
  onToggle,
}: AiConsentBarProps) {
  const C = Colors[scheme];
  if (!leavesDevice) return null;

  const label =
    providerType === 'builtin'
      ? 'Sunt de acord cu trimiterea datelor la serviciul Dosar AI'
      : providerType === 'local'
        ? 'Sunt de acord cu trimiterea pozelor documentelor la providerul de imagini'
        : 'Sunt de acord cu trimiterea datelor la serviciul AI configurat';

  return (
    <Pressable
      style={[
        styles.bar,
        {
          backgroundColor: C.card,
          borderBottomColor: C.border,
          borderTopColor: checked ? primary : C.border,
        },
      ]}
      onPress={onToggle}
      accessibilityLabel="Acord utilizare AI"
      accessibilityState={{ checked }}
    >
      <View
        style={[
          styles.checkbox,
          {
            borderColor: checked ? primary : C.border,
            backgroundColor: checked ? primary : 'transparent',
          },
        ]}
      >
        {checked && <Ionicons name="checkmark" size={14} color="#fff" />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: C.text }]}>{label}</Text>
        <Text style={[styles.sub, { color: C.textSecondary }]}>
          {providerType === 'local'
            ? 'Doar pozele trimise cu „Trimite documentul la AI". Chat-ul și textul rămân pe telefon.'
            : 'Acoperă: textul citit din documente, entități, detalii documente, chat. „Notă privată" și PIN-ul nu pleacă niciodată.'}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
  },
  sub: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
});
