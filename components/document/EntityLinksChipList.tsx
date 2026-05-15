/**
 * Lista chip-uri cu entitățile legate la document, plus buton „+ Adaugă"
 * pentru a deschide picker-ul. Folosit în `documente/edit.tsx` ca etichetă
 * vizibilă a relațiilor curente.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { ENTITY_TYPE_EMOJI, type DocumentEntityLink } from '@/types';

interface EntityLinksChipListProps {
  scheme: 'light' | 'dark';
  entityLinks: DocumentEntityLink[];
  resolveEntityName: (link: DocumentEntityLink) => string;
  onRemove: (link: DocumentEntityLink) => void;
  onAdd: () => void;
}

export function EntityLinksChipList({
  scheme,
  entityLinks,
  resolveEntityName,
  onRemove,
  onAdd,
}: EntityLinksChipListProps) {
  const C = Colors[scheme];
  return (
    <View style={styles.row}>
      {entityLinks.length === 0 && (
        <Text style={[styles.placeholder, { color: C.textSecondary }]}>Nelegat</Text>
      )}
      {entityLinks.map((link, idx) => (
        <View
          key={`${link.entityType}-${link.entityId}-${idx}`}
          style={[styles.chip, { backgroundColor: C.card, borderColor: C.border }]}
        >
          <Text style={[styles.chipText, { color: C.text }]}>
            {ENTITY_TYPE_EMOJI[link.entityType]} {resolveEntityName(link)}
          </Text>
          <Pressable
            onPress={() => onRemove(link)}
            hitSlop={8}
            style={styles.removeBtn}
            accessibilityLabel="Elimină legătura"
          >
            <Text style={styles.removeBtnText}>✕</Text>
          </Pressable>
        </View>
      ))}
      <Pressable style={[styles.addBtn, { borderColor: primary }]} onPress={onAdd}>
        <Text style={[styles.addBtnText, { color: primary }]}>+ Adaugă</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  placeholder: { fontSize: 15, opacity: 0.5 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 16,
    borderWidth: 1,
    gap: 6,
  },
  chipText: { fontSize: 13 },
  removeBtn: { paddingHorizontal: 2 },
  removeBtnText: { color: statusColors.critical, fontSize: 14, fontWeight: '700' },
  addBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
  },
  addBtnText: { fontSize: 13, fontWeight: '500' },
});
