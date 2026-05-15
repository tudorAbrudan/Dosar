/**
 * Selector entități la care e legat un document — taburi cu categoriile
 * (Persoană, Vehicul, Proprietate, etc.) și chips cu numele entităților din
 * categoria curentă. Tap pe chip = toggle selectare.
 *
 * Folosit în `documente/add.tsx` la crearea unui document nou. `edit.tsx`
 * folosește un pattern diferit (modal-based), deci nu împărtășim acest
 * component cu el.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary, onPrimary } from '@/theme/colors';
import {
  ALL_ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  type DocumentEntityLink,
  type EntityType,
} from '@/types';

// check-hardcoded-entities-disable-next-cluster
const ENTITY_CATEGORIES: { key: EntityType; label: string }[] = ALL_ENTITY_TYPES.map(t => ({
  key: t,
  label: ENTITY_TYPE_LABELS[t],
}));

interface PickerEntity {
  id: string;
  label: string;
}

interface EntityLinkPickerProps {
  scheme: 'light' | 'dark';
  entityLinks: DocumentEntityLink[];
  pickerCategory: EntityType;
  pickerEntities: PickerEntity[];
  visibleEntityTypes: EntityType[];
  /** Folosit pentru a afișa numele entităților selectate în rezumat. */
  resolveEntityName: (link: DocumentEntityLink) => string;
  onChangeCategory: (category: EntityType) => void;
  onToggleEntity: (entityId: string) => void;
}

export function EntityLinkPicker({
  scheme,
  entityLinks,
  pickerCategory,
  pickerEntities,
  visibleEntityTypes,
  resolveEntityName,
  onChangeCategory,
  onToggleEntity,
}: EntityLinkPickerProps) {
  const C = Colors[scheme];
  const anyEntitySelected = entityLinks.length > 0;

  return (
    <View>
      <Text style={[styles.sectionLabel, { color: C.text }]}>
        Leagă de entitate
        {anyEntitySelected ? (
          <Text style={{ color: primary }}>
            {' '}
            · {entityLinks.length} {entityLinks.length === 1 ? 'selectată' : 'selectate'}
          </Text>
        ) : (
          <Text style={{ opacity: 0.5 }}> (opțional)</Text>
        )}
      </Text>

      {anyEntitySelected && (
        <Text style={[styles.summary, { color: C.textSecondary }]} numberOfLines={2}>
          {entityLinks.map(l => resolveEntityName(l)).join('  ·  ')}
        </Text>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabRow}
        contentContainerStyle={styles.tabRowContent}
      >
        {ENTITY_CATEGORIES.filter(cat => visibleEntityTypes.includes(cat.key)).map(
          ({ key, label }) => {
            const countInCat = entityLinks.filter(l => l.entityType === key).length;
            const active = pickerCategory === key;
            return (
              <Pressable
                key={key}
                style={[
                  styles.tab,
                  { borderColor: C.border },
                  active && styles.tabActive,
                ]}
                onPress={() => onChangeCategory(key)}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: C.text },
                    active && styles.tabTextActive,
                  ]}
                >
                  {label}
                  {countInCat > 0 ? ` (${countInCat})` : ''}
                </Text>
              </Pressable>
            );
          }
        )}
      </ScrollView>

      {pickerEntities.length === 0 ? (
        <Text style={[styles.empty, { color: C.textSecondary }]}>Nicio entitate adăugată.</Text>
      ) : (
        <View style={styles.chipsWrap}>
          {pickerEntities.map(e => {
            const isSelected = entityLinks.some(
              l => l.entityType === pickerCategory && l.entityId === e.id
            );
            return (
              <Pressable
                key={e.id}
                style={[
                  styles.chipItem,
                  { borderColor: C.border },
                  isSelected && styles.chipItemActive,
                ]}
                onPress={() => onToggleEntity(e.id)}
              >
                <Text
                  style={[
                    styles.chipLabel,
                    { color: C.text },
                    isSelected && styles.chipLabelActive,
                  ]}
                >
                  {isSelected ? `✓ ${e.label}` : e.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { marginTop: 8, fontSize: 15, fontWeight: '600' },
  summary: { fontSize: 12, marginBottom: 10, marginTop: -2 },
  tabRow: { marginBottom: 12, marginTop: 8 },
  tabRowContent: { flexDirection: 'row', gap: 8 },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
  },
  tabActive: { backgroundColor: primary, borderColor: primary },
  tabText: { fontSize: 12, fontWeight: '500' },
  tabTextActive: { color: onPrimary },
  empty: { opacity: 0.6, fontSize: 14, marginBottom: 20 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  chipItem: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipItemActive: { backgroundColor: primary, borderColor: primary },
  chipLabel: { fontSize: 14 },
  chipLabelActive: { color: onPrimary, fontWeight: '500' as const },
});
