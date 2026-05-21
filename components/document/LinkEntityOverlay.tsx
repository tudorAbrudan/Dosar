/**
 * Overlay full-screen pentru asocierea unei entități noi la un document deja
 * existent. Listează entitățile grupate pe tip (Persoane, Vehicule, ...) și
 * marchează cele deja legate cu „✓ Adăugat".
 *
 * Extras din `documente/edit.tsx`. Folosește `ENTITY_TYPE_LABELS` în loc de
 * 6 blocuri JSX hardcoded (vechi: ~150 linii inline cu cod copiat).
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import {
  ALL_ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  type DocumentEntityLink,
  type EntityType,
} from '@/types';

interface NamedEntity {
  id: string;
  /** Label-ul afișat în listă (poate fi `name`, `nickname`, etc.). */
  label: string;
}

interface LinkEntityOverlayProps {
  visible: boolean;
  scheme: 'light' | 'dark';
  entityLinks: DocumentEntityLink[];
  /** Entități grupate pe tip — caller produce label-ul potrivit per tip. */
  groups: Partial<Record<EntityType, NamedEntity[]>>;
  /** Plural / label de afișat pentru fiecare grup (overrride opțional). */
  groupLabels?: Partial<Record<EntityType, string>>;
  onAdd: (link: DocumentEntityLink) => void;
  onClose: () => void;
}

// check-hardcoded-entities-disable-next-cluster
const DEFAULT_GROUP_LABELS: Record<EntityType, string> = {
  person: 'Persoane',
  vehicle: 'Vehicule',
  property: 'Proprietăți',
  card: 'Carduri',
  animal: 'Animale',
  company: 'Firme',
  medical_record: 'Dosare medicale',
};

export function LinkEntityOverlay({
  visible,
  scheme,
  entityLinks,
  groups,
  groupLabels,
  onAdd,
  onClose,
}: LinkEntityOverlayProps) {
  const C = Colors[scheme];
  if (!visible) return null;

  return (
    <View style={styles.overlay}>
      <View style={[styles.box, { backgroundColor: C.card }]}>
        <Text style={[styles.title, { color: C.text }]}>Adaugă entitate asociată</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
          {ALL_ENTITY_TYPES.map(entityType => {
            const items = groups[entityType] ?? [];
            if (items.length === 0) return null;
            const groupLabel =
              groupLabels?.[entityType] ?? DEFAULT_GROUP_LABELS[entityType] ?? ENTITY_TYPE_LABELS[entityType];
            return (
              <View key={entityType}>
                <Text style={[styles.groupLabel, { color: C.textSecondary }]}>{groupLabel}</Text>
                {items.map(item => {
                  const linked = entityLinks.some(
                    l => l.entityType === entityType && l.entityId === item.id
                  );
                  return (
                    <Pressable
                      key={item.id}
                      style={[styles.row, { borderBottomColor: C.border }]}
                      onPress={() => onAdd({ entityType, entityId: item.id })}
                    >
                      <Text style={[styles.rowText, { color: C.text }]}>{item.label}</Text>
                      {linked && <Text style={styles.linkedBadge}>✓ Adăugat</Text>}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
        <Pressable
          style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}
          onPress={onClose}
          accessibilityLabel="Închide picker entități"
          accessibilityRole="button"
        >
          <Text style={[styles.closeBtnText, { color: primary }]}>Închide</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Overlay dark este intenționat universal (apare peste orice temă).
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  box: { width: '100%', borderRadius: 16, padding: 16, maxWidth: 480 },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 12 },
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { fontSize: 15 },
  linkedBadge: { color: primary, fontSize: 13 },
  closeBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 8 },
  closeBtnText: { fontSize: 15, fontWeight: '600' },
});
