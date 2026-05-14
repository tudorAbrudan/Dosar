import { View, Text, Pressable, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import type { LocalModelEntry } from '@/services/localModel';

type ModelWithCompat = LocalModelEntry & { incompatibilityReason: string | null };

interface LocalModelSelectorProps {
  /** ID-urile modelelor descărcate pe device. */
  downloadedIds: string[];
  /** Catalogul complet (folosit pentru lookup pe nume + qualityStars). */
  allModels: ModelWithCompat[];
  /** Provider AI activ — dacă nu e 'local', niciun model nu apare ca selectat. */
  providerType: string;
  /** ID-ul modelului local selectat în prezent. */
  selectedId: string | null;
  scheme: 'light' | 'dark';
  onSelect: (modelId: string) => void;
}

/**
 * Lista de radio buttons cu modelele AI on-device descărcate.
 * Vizibilă DOAR când există cel puțin un model descărcat.
 */
export function LocalModelSelector({
  downloadedIds,
  allModels,
  providerType,
  selectedId,
  scheme,
  onSelect,
}: LocalModelSelectorProps) {
  const C = Colors[scheme];
  if (downloadedIds.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: C.textSecondary }]}>Modele locale instalate</Text>
      {downloadedIds.map(modelId => {
        const model = allModels.find(m => m.id === modelId);
        if (!model) return null;
        const isSelected = providerType === 'local' && selectedId === modelId;
        return (
          <Pressable
            key={modelId}
            style={[
              styles.radioRow,
              { borderColor: isSelected ? primary : C.border, backgroundColor: C.card },
            ]}
            onPress={() => onSelect(modelId)}
            accessibilityLabel={`Selectează model ${model.name}`}
          >
            <View
              style={[styles.radioDot, { borderColor: isSelected ? primary : C.border }]}
            >
              {isSelected && (
                <View style={[styles.radioDotInner, { backgroundColor: primary }]} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: C.text }]}>{model.name}</Text>
              <Text style={[styles.meta, { color: C.textSecondary }]}>
                {'★'.repeat(model.qualityStars)} · {model.sizeLabel}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 8 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
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
  name: {
    fontSize: 13,
    fontWeight: '500',
  },
  meta: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
});
