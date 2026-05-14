import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';

interface AiPrivacyInfoCardProps {
  scheme: 'light' | 'dark';
}

/**
 * Card informativ în modalul de configurare AI care reamintește:
 * 1. Imaginile pleacă la AI doar la apăsare manuală — niciodată automat.
 * 2. Câmpul „Notă privată" NU pleacă niciodată la AI (sigur pentru CVV/PIN/parole).
 *
 * Mirror al onboarding-ului OCR_PRIVACY. Afișat doar pentru builtin/external (la `none`
 * și `local` informația nu se aplică).
 */
export function AiPrivacyInfoCard({ scheme }: AiPrivacyInfoCardProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={styles.row}>
        <Ionicons
          name="image-outline"
          size={18}
          color={statusColors.warning}
          style={styles.icon}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: C.text }]}>Trimitere imagine/document la AI</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            Doar la apăsarea butonului „Trimite documentul la AI" din formularul documentului —
            niciodată automat.
          </Text>
        </View>
      </View>
      <View style={styles.row}>
        <Ionicons
          name="lock-closed-outline"
          size={18}
          color={primary}
          style={styles.icon}
        />
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: C.text }]}>
            Câmpul „Notă privată" nu pleacă niciodată la AI
          </Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            Folosește-l pentru date strict sensibile (CVV, PIN, parole). E separat de câmpul
            „Notă" normal.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  icon: { marginTop: 2 },
  title: {
    fontSize: 13,
    fontWeight: '600',
  },
  sub: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
});
