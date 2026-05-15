/**
 * Card afișat în detaliul documentului când există duplicate detectate.
 * Două secțiuni:
 *   1. „Fișier identic" (byHash) — match exact pe SHA-256
 *   2. „Același tip și entitate" (byTypeAndEntity) — sau, pentru tipuri
 *      repetabile (facturi), „Același tip + aceeași dată de emitere"
 *
 * Extras din `documente/[id].tsx`.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { sensitive, sensitiveBorder, sensitiveBg } from '@/theme/colors';
import { getDocumentLabel, REPEATABLE_DOC_TYPES } from '@/types';
import type { Document, CustomDocumentType } from '@/types';
import type { DocumentDuplicates } from '@/services/documents';

interface DuplicateGroupsCardProps {
  scheme: 'light' | 'dark';
  doc: Document;
  duplicates: DocumentDuplicates;
  customTypes: CustomDocumentType[];
  onOpenDocument: (id: string) => void;
}

export function DuplicateGroupsCard({
  scheme,
  doc,
  duplicates,
  customTypes,
  onOpenDocument,
}: DuplicateGroupsCardProps) {
  const C = Colors[scheme];
  if (duplicates.byHash.length === 0 && duplicates.byTypeAndEntity.length === 0) {
    return null;
  }

  const byTypeLabel = REPEATABLE_DOC_TYPES.has(doc.type)
    ? `Același tip + aceeași dată de emitere (${duplicates.byTypeAndEntity.length})`
    : `Același tip și entitate (${duplicates.byTypeAndEntity.length})`;

  return (
    <View style={styles.box}>
      <View style={styles.header}>
        <Ionicons name="copy-outline" size={14} color={sensitive} />
        <Text style={[styles.headerText, { color: sensitive }]}>Posibil duplicat</Text>
      </View>
      {duplicates.byHash.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: C.textSecondary }]}>
            Fișier identic ({duplicates.byHash.length})
          </Text>
          {duplicates.byHash.map(d => (
            <Pressable key={d.id} style={styles.row} onPress={() => onOpenDocument(d.id)}>
              <Text style={[styles.rowText, { color: C.text }]} numberOfLines={1}>
                {getDocumentLabel(d, customTypes)}
                {d.created_at
                  ? ` · ${new Date(d.created_at).toLocaleDateString('ro-RO')}`
                  : ''}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={sensitive} />
            </Pressable>
          ))}
        </View>
      )}
      {duplicates.byTypeAndEntity.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: C.textSecondary }]}>{byTypeLabel}</Text>
          {duplicates.byTypeAndEntity.map(d => (
            <Pressable key={d.id} style={styles.row} onPress={() => onOpenDocument(d.id)}>
              <Text style={[styles.rowText, { color: C.text }]} numberOfLines={1}>
                {getDocumentLabel(d, customTypes)}
                {d.expiry_date
                  ? ` · expiră ${new Date(d.expiry_date).toLocaleDateString('ro-RO')}`
                  : d.issue_date
                    ? ` · emis ${new Date(d.issue_date).toLocaleDateString('ro-RO')}`
                    : ''}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={sensitive} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 8,
    backgroundColor: sensitiveBg,
    borderWidth: 1,
    borderColor: sensitiveBorder,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  headerText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  section: { marginTop: 8 },
  sectionLabel: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    gap: 8,
  },
  rowText: { flex: 1, fontSize: 13 },
});
