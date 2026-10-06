/**
 * Modal pentru reordonarea manuală (drag & drop) a documentelor dintr-o entitate.
 * Long-press pe un rând → trage în noua poziție. „Salvează" persistă ordinea,
 * „Anulează" o ignoră. Fără câmpuri de input → nu intră sub regula FormSheetModal.
 */
import { useEffect, useState } from 'react';
import { SheetHeader } from '@/components/ui/SheetHeader';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const insets = useSafeAreaInsets();
  const [order, setOrder] = useState<Document[]>(documents);

  // La fiecare deschidere pornim de la ordinea curentă din ecran.
  useEffect(() => {
    if (visible) setOrder(documents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return;
    const next = order.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      // fullScreen, nu pageSheet: gestul de swipe al sheet-ului iOS fura drag-ul vertical
      // și trăgea fereastra în loc de document.
      presentationStyle="fullScreen"
      onRequestClose={saving ? () => {} : onClose}
    >
      <View style={[styles.flex, { backgroundColor: C.background }]}>
        <SheetHeader
          title="Ordonează documentele"
          onCancel={onClose}
          onSave={() => onSave(order.map(d => d.id))}
          saving={saving}
          paddingTop={insets.top + 6}
        />
        <Text style={[styles.hint, { color: C.textSecondary }]}>
          Atinge săgețile sau ține apăsat pe un document (ori pe săgeți) și trage-l în noua poziție.
        </Text>
        <DraggableEntityList<Document>
          data={order}
          keyExtractor={d => d.id}
          onReorder={setOrder}
          contentContainerStyle={styles.listContent}
          renderItem={(doc, { isActive, onLongPress }) => {
            const index = order.findIndex(d => d.id === doc.id);
            return (
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
                <Pressable
                  onPress={() => move(index, index - 1)}
                  onLongPress={onLongPress}
                  delayLongPress={LONG_PRESS_DELAY_MS}
                  hitSlop={8}
                >
                  <Ionicons name="chevron-up" size={22} color={index <= 0 ? C.border : primary} />
                </Pressable>
                <Pressable
                  onPress={() => move(index, index + 1)}
                  onLongPress={onLongPress}
                  delayLongPress={LONG_PRESS_DELAY_MS}
                  hitSlop={8}
                >
                  <Ionicons
                    name="chevron-down"
                    size={22}
                    color={index >= order.length - 1 ? C.border : primary}
                  />
                </Pressable>
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
