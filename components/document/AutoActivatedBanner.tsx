import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DocumentType } from '@/types';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import { useColorScheme } from '@/components/useColorScheme';
import { statusColors } from '@/theme/colors';
import Colors from '@/constants/Colors';

interface AutoActivatedBannerProps {
  type: DocumentType;
  onDismiss: () => void;
}

/**
 * Banner verde care confirmă auto-activarea unui tip de document detectat de AI
 * dar care nu era vizibil în Setări. Apare ~5s (timer-ul e gestionat de
 * `useAutoActivateDocType`), poate fi închis manual cu X.
 */
export function AutoActivatedBanner({ type, onDismiss }: AutoActivatedBannerProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: C.primaryMuted, borderColor: statusColors.ok },
      ]}
    >
      <Ionicons
        name="checkmark-circle"
        size={18}
        color={statusColors.ok}
        style={styles.icon}
      />
      <View style={styles.content}>
        <Text style={[styles.title, { color: C.text }]}>
          Tipul „{DOCUMENT_TYPE_LABELS[type] ?? type}" a fost activat automat
        </Text>
        <Text style={[styles.body, { color: C.textSecondary }]}>
          Apare acum în Setări → Tipuri de documente vizibile.
        </Text>
      </View>
      <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Închide notificarea">
        <Ionicons name="close" size={16} color={C.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  icon: { marginRight: 8, marginTop: 1 },
  content: { flex: 1 },
  title: { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  body: { fontSize: 12, lineHeight: 17 },
});
