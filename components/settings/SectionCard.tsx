import { View, Text, StyleSheet, Platform } from 'react-native';
import Colors from '@/constants/Colors';

interface SectionCardProps {
  title: string;
  scheme: 'light' | 'dark';
  children: React.ReactNode;
}

/**
 * Wrapper standard pentru o secțiune din Setări:
 * - title în UPPERCASE deasupra
 * - card cu fundal + shadow ușor
 * - children sunt rândurile (InfoRow, custom rows)
 *
 * Folosit ca primitive de toate sub-componentele Settings (Onboarding, About, etc.).
 */
export function SectionCard({ title, scheme, children }: SectionCardProps) {
  const C = Colors[scheme];
  return (
    <>
      <Text style={[styles.label, { color: C.textSecondary }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
        {children}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 20,
    marginLeft: 4,
    textTransform: 'uppercase',
  },
  card: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
});
