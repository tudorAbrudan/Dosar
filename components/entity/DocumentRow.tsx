/**
 * Card-row pentru un document afișat în lista de "Documente legate" pe ecranul
 * entității. Reutilizabil — folosit pentru orice tip de entitate.
 *
 * Extras din `entitati/[id].tsx`.
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Colors from '@/constants/Colors';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { Document } from '@/types';

interface DocumentRowProps {
  doc: Document;
  scheme: 'light' | 'dark';
  onPress: () => void;
}

export function DocumentRow({ doc, scheme, onPress }: DocumentRowProps) {
  const C = Colors[scheme];
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: C.card, shadowColor: C.cardShadow },
        pressed && styles.rowPressed,
      ]}
      onPress={onPress}
    >
      <View style={styles.text}>
        <Text style={[styles.type, { color: C.text }]}>
          {DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type}
        </Text>
        {doc.issue_date && (
          <Text style={[styles.meta, { color: C.textSecondary }]}>Emis: {doc.issue_date}</Text>
        )}
        {doc.expiry_date && (
          <Text style={[styles.meta, { color: C.textSecondary }]}>
            Expiră: {doc.expiry_date}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  rowPressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  text: { flex: 1 },
  type: { fontSize: 15, fontWeight: '500' },
  meta: { fontSize: 13, marginTop: 3 },
});
