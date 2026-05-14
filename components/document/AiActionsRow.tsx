import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { primary, statusColors } from '@/theme/colors';
import Colors from '@/constants/Colors';

interface AiActionsRowProps {
  /** AI flow rulează (OCR sau LLM) */
  busy: boolean;
  /** Label pentru loading state (diferențiat între OCR și LLM) */
  busyLabel: string;
  /** Affichează butonul „Trimite la AI" doar dacă user-ul a dat consent + sunt pagini */
  showAction: boolean;
  onAction: () => void;
}

/**
 * Rândul cu butonul „Trimite documentul la AI" și starea de loading.
 * Folosit în ecranele de adăugare / editare document după ce user-ul atașează pagini.
 */
export function AiActionsRow({ busy, busyLabel, showAction, onAction }: AiActionsRowProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  if (busy) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color={primary} style={styles.spinner} />
        <Text style={[styles.loadingText, { color: C.textSecondary }]}>{busyLabel}</Text>
      </View>
    );
  }

  if (!showAction) return null;

  return (
    <View>
      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionBtn,
            { borderColor: statusColors.warning, opacity: pressed ? 0.75 : 1 },
          ]}
          onPress={onAction}
          accessibilityLabel="Trimite documentul la AI"
        >
          <Text style={[styles.actionBtnText, { color: statusColors.warning }]}>
            Trimite documentul la AI
          </Text>
        </Pressable>
      </View>
      <Text style={[styles.info, { color: C.textSecondary }]}>
        Se trimite imaginea/PDF-ul documentului la AI pentru extragerea datelor. Acțiune
        manuală explicită.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  spinner: { marginRight: 6 },
  loadingText: { fontSize: 13 },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  info: {
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 12,
  },
});
