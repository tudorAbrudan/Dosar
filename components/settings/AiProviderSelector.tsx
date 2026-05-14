import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import * as aiProvider from '@/services/aiProvider';
import type { AiProviderType } from '@/services/aiProvider';

interface AiProviderSelectorProps {
  selected: AiProviderType;
  scheme: 'light' | 'dark';
  onSelect: (type: AiProviderType) => void;
}

const OPTIONS: AiProviderType[] = ['none', 'builtin', 'external'];

/**
 * Radio buttons pentru selectarea providerului AI (None / Builtin / External).
 * Selecția „local" e tratată separat (vezi LocalModelCatalog).
 */
export function AiProviderSelector({ selected, scheme, onSelect }: AiProviderSelectorProps) {
  const C = Colors[scheme];
  return (
    <View>
      <Text style={[styles.label, { color: C.textSecondary }]}>Configurare asistent AI</Text>
      {OPTIONS.map(type => (
        <Pressable
          key={type}
          style={[
            styles.radioRow,
            {
              borderColor: selected === type ? primary : C.border,
              backgroundColor: C.card,
            },
          ]}
          onPress={() => onSelect(type)}
          accessibilityLabel={`Provider AI: ${aiProvider.PROVIDER_DEFAULTS[type].label}`}
        >
          <View
            style={[
              styles.radioDot,
              { borderColor: selected === type ? primary : C.border },
            ]}
          >
            {selected === type && (
              <View style={[styles.radioDotInner, { backgroundColor: primary }]} />
            )}
          </View>
          <Text style={[styles.label2, { color: C.text }]}>
            {aiProvider.PROVIDER_DEFAULTS[type].label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  label2: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 8,
  },
  radioDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  radioDotInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
