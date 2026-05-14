import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import type { AiProviderType } from '@/services/aiProvider';

interface AiConsentBarProps {
  providerType: AiProviderType;
  checked: boolean;
  scheme: 'light' | 'dark';
  onToggle: () => void;
}

/**
 * Bară fixă cu checkbox pentru acordul de utilizare AI.
 * Apare doar pentru providerType `builtin` sau `external` (la `none`/`local` nu pleacă date).
 */
export function AiConsentBar({ providerType, checked, scheme, onToggle }: AiConsentBarProps) {
  const C = Colors[scheme];
  if (providerType !== 'builtin' && providerType !== 'external') return null;

  const label =
    providerType === 'builtin'
      ? 'Sunt de acord cu trimiterea datelor la serviciul Dosar AI'
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
          Acoperă: text OCR, entități, detalii documente, chat. PIN-ul nu este niciodată trimis.
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
