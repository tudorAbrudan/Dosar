import { useState, useEffect, useMemo } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { DOCUMENT_TYPE_LABELS, STANDARD_DOC_TYPES } from '@/types';
import type { DocumentType } from '@/types';
import type { ClassifyCandidate } from '@/services/aiClassifier';

type Props = {
  visible: boolean;
  top3: ClassifyCandidate[];
  /** Tipuri permise în picker-ul „Caută alt tip" (default: STANDARD_DOC_TYPES). */
  allowedTypes?: DocumentType[];
  onCancel: () => void;
  onConfirm: (type: DocumentType) => void;
};

export function ClassifyConfirmSheet({ visible, top3, allowedTypes, onCancel, onConfirm }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const [selected, setSelected] = useState<DocumentType | null>(null);
  const [browseAll, setBrowseAll] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelected(top3[0]?.type ?? null);
      setBrowseAll(false);
    }
  }, [visible, top3]);

  const fullList = useMemo<DocumentType[]>(() => {
    const base = allowedTypes ?? STANDARD_DOC_TYPES;
    return base.filter(t => t !== 'custom');
  }, [allowedTypes]);

  function handleConfirm() {
    if (selected) onConfirm(selected);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <View style={[styles.flex, { backgroundColor: C.background }]}>
        <View style={[styles.header, { borderBottomColor: C.border }]}>
          <Pressable onPress={onCancel} hitSlop={12}>
            <Text style={[styles.action, { color: C.textSecondary }]}>Anulează</Text>
          </Pressable>
          <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
            Confirmă tipul
          </Text>
          <Pressable onPress={handleConfirm} disabled={!selected} hitSlop={12}>
            <Text
              style={[
                styles.action,
                { color: primary, fontWeight: '600' },
                !selected && styles.actionDisabled,
              ]}
            >
              Confirmă
            </Text>
          </Pressable>
        </View>

        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          {!browseAll ? (
            <>
              <Text style={[styles.intro, { color: C.textSecondary }]}>
                AI-ul nu este complet sigur. Alege tipul corect:
              </Text>
              {top3.length === 0 ? (
                <Text style={[styles.empty, { color: C.textSecondary }]}>
                  Nu am sugestii. Apasă „Caută alt tip" pentru a alege manual.
                </Text>
              ) : (
                top3.map(c => {
                  const isSelected = selected === c.type;
                  return (
                    <Pressable
                      key={c.type}
                      onPress={() => setSelected(c.type)}
                      style={[
                        styles.card,
                        {
                          backgroundColor: C.card,
                          borderColor: isSelected ? primary : C.border,
                          borderWidth: isSelected ? 2 : 1,
                        },
                      ]}
                    >
                      <View style={styles.cardRow}>
                        <Text style={[styles.cardLabel, { color: C.text }]}>
                          {DOCUMENT_TYPE_LABELS[c.type] ?? c.type}
                        </Text>
                        <Text style={[styles.cardConfidence, { color: C.textSecondary }]}>
                          {Math.round(c.confidence * 100)}%
                        </Text>
                      </View>
                    </Pressable>
                  );
                })
              )}
              <Pressable
                onPress={() => setBrowseAll(true)}
                style={[styles.altButton, { borderColor: C.border }]}
              >
                <Text style={[styles.altButtonText, { color: primary }]}>Caută alt tip</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[styles.intro, { color: C.textSecondary }]}>
                Alege tipul potrivit din listă:
              </Text>
              {fullList.map(t => {
                const isSelected = selected === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setSelected(t)}
                    style={[
                      styles.card,
                      {
                        backgroundColor: C.card,
                        borderColor: isSelected ? primary : C.border,
                        borderWidth: isSelected ? 2 : 1,
                      },
                    ]}
                  >
                    <Text style={[styles.cardLabel, { color: C.text }]}>
                      {DOCUMENT_TYPE_LABELS[t] ?? t}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => setBrowseAll(false)}
                style={[styles.altButton, { borderColor: C.border }]}
              >
                <Text style={[styles.altButtonText, { color: primary }]}>Înapoi la sugestii</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontWeight: '600' },
  action: { fontSize: 16 },
  actionDisabled: { opacity: 0.4 },
  content: { padding: 16, gap: 8 },
  intro: { fontSize: 14, marginBottom: 8 },
  empty: { fontSize: 14, fontStyle: 'italic', textAlign: 'center', marginVertical: 24 },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardLabel: { fontSize: 16, fontWeight: '500' },
  cardConfidence: { fontSize: 14 },
  altButton: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  altButtonText: { fontSize: 16, fontWeight: '600' },
});
