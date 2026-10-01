/**
 * Modal pentru reordonarea manuală (drag & drop) a documentelor dintr-o entitate.
 * Long-press pe un rând → trage în noua poziție. „Salvează" persistă ordinea,
 * „Anulează" o ignoră. Fără câmpuri de input → nu intră sub regula FormSheetModal.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { DraggableEntityList, LONG_PRESS_DELAY_MS } from '@/components/DraggableEntityList';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { getDocumentLabel } from '@/types';
import type { CustomDocumentType, Document } from '@/types';

interface Props {
  visible: boolean;
  documents: Document[];
  customTypes: CustomDocumentType[];
  scheme: 'light' | 'dark';
  saving?: boolean;
  onClose: () => void;
  onSave: (orderedDocumentIds: string[]) => void;
}

export function ReorderDocumentsModal({
  visible,
  documents,
  customTypes,
  scheme,
  saving = false,
  onClose,
  onSave,
}: Props) {
  const C = Colors[scheme];
  const [order, setOrder] = useState<Document[]>(documents);

  // La fiecare deschidere pornim de la ordinea curentă din ecran.
  useEffect(() => {
    if (visible) setOrder(documents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={saving ? () => {} : onClose}
    >
      <View style={[styles.flex, { backgroundColor: C.background }]}>
        <View style={[styles.header, { borderBottomColor: C.border }]}>
          <Pressable onPress={onClose} disabled={saving} hitSlop={12}>
            <Text style={[styles.action, { color: C.textSecondary }]}>Anulează</Text>
          </Pressable>
          <Text style={[styles.title, { color: C.text }]}>Ordonează documentele</Text>
          <Pressable onPress={() => onSave(order.map(d => d.id))} disabled={saving} hitSlop={12}>
            <Text style={[styles.action, styles.save, { color: primary }]}>Salvează</Text>
          </Pressable>
        </View>
        <Text style={[styles.hint, { color: C.textSecondary }]}>
          Ține apăsat pe un document și trage-l în noua poziție.
        </Text>
        <DraggableEntityList<Document>
          data={order}
          keyExtractor={d => d.id}
          onReorder={setOrder}
          contentContainerStyle={styles.listContent}
          renderItem={(doc, { isActive, onLongPress }) => (
            <Pressable
              onLongPress={onLongPress}
              delayLongPress={LONG_PRESS_DELAY_MS}
              style={[
                styles.row,
                { backgroundColor: C.card, shadowColor: C.cardShadow },
                isActive && { borderColor: primary, borderWidth: 1 },
              ]}
            >
              <Ionicons name="reorder-three" size={22} color={C.textSecondary} />
              <View style={styles.text}>
                <Text style={[styles.type, { color: C.text }]} numberOfLines={1}>
                  {getDocumentLabel(doc, customTypes)}
                </Text>
                {(doc.issue_date || doc.expiry_date) && (
                  <Text style={[styles.meta, { color: C.textSecondary }]}>
                    {doc.issue_date ? `Emis: ${doc.issue_date}` : `Expiră: ${doc.expiry_date}`}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontWeight: '600' },
  action: { fontSize: 16 },
  save: { fontWeight: '600' },
  hint: { fontSize: 13, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  listContent: { padding: 16 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  text: { flex: 1 },
  type: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 2 },
});
