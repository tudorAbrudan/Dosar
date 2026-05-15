/**
 * Bara de statistici de sus din ecranul FuelScreen — 3 carduri (înreg., L total,
 * RON), chart-ul de consum + link la „statistici detaliate".
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { FuelConsumptionChart } from '@/components/FuelConsumptionChart';
import { dark, light, primary } from '@/theme/colors';
import type { FuelStats } from '@/services/fuel';

interface FuelStatsBarProps {
  stats: FuelStats;
  scheme: 'light' | 'dark' | null | undefined;
  onOpenDetails: () => void;
}

export function FuelStatsBar({ stats, scheme, onOpenDetails }: FuelStatsBarProps) {
  const palette = scheme === 'dark' ? dark : light;
  return (
    <>
      <View style={styles.bar}>
        <View style={[styles.card, { backgroundColor: palette.card }]}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {stats.totalRecords}
          </Text>
          <Text style={[styles.label, { color: palette.textSecondary }]}>înreg.</Text>
        </View>
        <View style={[styles.card, { backgroundColor: palette.card }]}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {stats.totalLiters.toFixed(1)}
          </Text>
          <Text style={[styles.label, { color: palette.textSecondary }]}>L total</Text>
        </View>
        <View style={[styles.card, { backgroundColor: palette.card }]}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
            {stats.totalCost.toFixed(2)}
          </Text>
          <Text style={[styles.label, { color: palette.textSecondary }]}>RON</Text>
        </View>
      </View>
      <FuelConsumptionChart
        values={stats.consumptionSparkline}
        averageL100={stats.avgConsumptionL100}
        cardColor={palette.card}
        textSecondary={palette.textSecondary}
      />
      <Pressable
        onPress={onOpenDetails}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
      >
        <Text style={[styles.linkText, { color: primary }]}>Vezi statistici detaliate →</Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    backgroundColor: 'transparent',
  },
  card: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  value: { fontSize: 15, fontWeight: '700', color: primary },
  label: { fontSize: 11, marginTop: 2, textAlign: 'center' },
  link: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  linkText: { fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
