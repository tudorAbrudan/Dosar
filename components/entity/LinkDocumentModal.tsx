/**
 * Modal pentru asocierea unui document existent (nelegat) la entitatea curentă.
 *
 * Extras din `entitati/[id].tsx`.
 */
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { getDocumentLabel } from '@/types';
import type { CustomDocumentType, Document } from '@/types';

interface LinkDocumentModalProps {
  visible: boolean;
  unlinkedDocs: Document[];
  scheme: 'light' | 'dark';
  customTypes: CustomDocumentType[];
  onClose: () => void;
  onLink: (docId: string) => void;
}

export function LinkDocumentModal({
  visible,
  unlinkedDocs,
  scheme,
  customTypes,
  onClose,
  onLink,
}: LinkDocumentModalProps) {
  const C = Colors[scheme];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.content, { backgroundColor: C.card }]}>
          <Text style={[styles.title, { color: C.text }]}>Asociază document existent</Text>
          {unlinkedDocs.length === 0 ? (
            <Text style={[styles.label, { color: C.textSecondary, marginBottom: 16 }]}>
              Nu există documente nelegate disponibile.
            </Text>
          ) : (
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {unlinkedDocs.map(d => (
                <Pressable
                  key={d.id}
                  style={[styles.row, { borderBottomColor: C.border }]}
                  onPress={() => onLink(d.id)}
                >
                  <Text style={[styles.rowType, { color: C.primary }]}>
                    {getDocumentLabel(d, customTypes)}
                  </Text>
                  {d.note ? (
                    <Text
                      style={[styles.rowMeta, { color: C.textSecondary }]}
                      numberOfLines={1}
                    >
                      {d.note}
                    </Text>
                  ) : null}
                  {d.expiry_date ? (
                    <Text style={[styles.rowMeta, { color: C.textSecondary }]}>
                      Expiră: {d.expiry_date}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          )}
          <View style={styles.buttons}>
            <Pressable
              style={[styles.cancelBtn, { borderColor: C.border }]}
              onPress={onClose}
            >
              <Text style={[styles.cancelText, { color: C.text }]}>Anulare</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Overlay dark este intenționat universal (apare peste orice temă).
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  content: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
  label: { fontSize: 14, marginBottom: 6 },
  row: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowType: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 13, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: { fontSize: 16, opacity: 0.8 },
});
