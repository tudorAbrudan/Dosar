import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, statusColors } from '@/theme/colors';

/**
 * Afișat pe ecrane de detaliu entitate/document primite ca share read-only —
 * userul poate vedea, nu poate edita. Randat condițional de caller
 * (`{readOnly && <ReadOnlyShareBanner />}`), nu face fetch intern.
 */
export function ReadOnlyShareBanner() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  return (
    <View style={[styles.wrap, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <Ionicons name="eye-outline" size={20} color={statusColors.warning} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: palette.text }]}>Doar citire</Text>
        <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
          E partajat cu tine — nu poți edita sau șterge.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  body: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
});
