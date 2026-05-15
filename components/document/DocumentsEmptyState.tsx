/**
 * Empty state pentru lista de documente — mesaj diferit dacă lista e filtrată
 * (search activ sau tip selectat) vs. lista globală.
 */
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';

interface DocumentsEmptyStateProps {
  isFiltered: boolean;
  scheme: 'light' | 'dark';
}

export function DocumentsEmptyState({ isFiltered, scheme }: DocumentsEmptyStateProps) {
  const C = Colors[scheme];
  return (
    <View style={styles.wrap}>
      <Ionicons name="document-outline" size={64} color={C.textSecondary} style={styles.icon} />
      <Text style={[styles.title, { color: C.text }]}>
        {isFiltered ? 'Niciun rezultat' : 'Niciun document'}
      </Text>
      <Text style={[styles.sub, { color: C.textSecondary }]}>
        {isFiltered
          ? 'Încearcă alte filtre sau șterge căutarea.'
          : 'Apasă + pentru a adăuga primul tău document.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginTop: 60, paddingHorizontal: 32 },
  icon: { marginBottom: 16, opacity: 0.4 },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  sub: { fontSize: 14, textAlign: 'center', lineHeight: 20, opacity: 0.8 },
});
