/**
 * Card-ul unei înregistrări de carburant în lista din FuelScreen.
 * Calculează km parcurși și consumul L/100km de la ultima alimentare
 * (sau plin complet anterior).
 */
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { dark, light, primary, statusColors } from '@/theme/colors';
import type { FuelRecord } from '@/services/fuel';

interface FuelRecordCardProps {
  record: FuelRecord;
  index: number;
  records: FuelRecord[];
  scheme: 'light' | 'dark' | null | undefined;
  cardColor: string;
  onPress: () => void;
  onLongPress: () => void;
}

export function FuelRecordCard({
  record,
  index,
  records,
  scheme,
  cardColor,
  onPress,
  onLongPress,
}: FuelRecordCardProps) {
  const palette = scheme === 'dark' ? dark : light;

  // records sortate DESC după dată → "anteriorul" chronologic e records[index+1]
  const prev = index + 1 < records.length ? records[index + 1] : null;

  let kmSinceLast: number | undefined;
  if (prev && record.km_total !== undefined && prev.km_total !== undefined) {
    const delta = record.km_total - prev.km_total;
    if (delta > 0) kmSinceLast = delta;
  }

  // Consum mediu doar la bonurile pline. Adună litrii din toate bonurile
  // (parțiale + acest plin) de la ultimul plin anterior și împarte la km parcurși.
  let consumptionSinceLast: number | undefined;
  if (record.is_full && record.km_total !== undefined) {
    let prevFullIdx = -1;
    for (let j = index + 1; j < records.length; j++) {
      if (records[j].is_full && records[j].km_total !== undefined) {
        prevFullIdx = j;
        break;
      }
    }
    if (prevFullIdx !== -1) {
      const prevFull = records[prevFullIdx];
      const kmDelta = record.km_total - (prevFull.km_total ?? 0);
      let totalLiters = 0;
      for (let j = index; j < prevFullIdx; j++) {
        totalLiters += records[j].liters ?? 0;
      }
      if (kmDelta > 0 && totalLiters > 0) {
        consumptionSinceLast = (totalLiters / kmDelta) * 100;
      }
    }
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: cardColor },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.date}>{record.date}</Text>
          {!record.is_full && (
            <View style={styles.partialChip}>
              <Text style={styles.partialChipText}>PARȚIAL</Text>
            </View>
          )}
        </View>
        {record.price !== undefined && (
          <Text style={styles.price}>{record.price.toFixed(2)} RON</Text>
        )}
      </View>
      <View style={styles.details}>
        {record.liters !== undefined && (
          <Text style={styles.meta}>{record.liters.toFixed(2)} L</Text>
        )}
        {record.km_total !== undefined && (
          <Text style={styles.meta}>{record.km_total.toLocaleString('ro-RO')} km</Text>
        )}
      </View>
      {record.station && (
        <Text style={[styles.station, { color: palette.textSecondary }]}>📍 {record.station}</Text>
      )}
      {prev && (
        <Text style={[styles.sinceLast, { color: palette.textSecondary }]}>
          De la ultima:{' '}
          {kmSinceLast !== undefined ? `${kmSinceLast.toLocaleString('ro-RO')} km` : '– km'} ·{' '}
          {consumptionSinceLast !== undefined
            ? `${consumptionSinceLast.toFixed(1)} L/100km`
            : '– L/100km'}
        </Text>
      )}
      <Text style={styles.hint}>Apasă pentru editare · lung pentru ștergere</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
    marginBottom: 6,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  partialChip: {
    backgroundColor: statusColors.warningSurface,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  partialChipText: {
    color: statusColors.warning,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  date: { fontSize: 15, fontWeight: '600' },
  price: { fontSize: 15, fontWeight: '700', color: primary },
  details: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: 'transparent',
  },
  meta: { fontSize: 13, opacity: 0.7 },
  station: { fontSize: 12, marginTop: 4 },
  sinceLast: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  hint: { fontSize: 11, opacity: 0.35, marginTop: 4 },
  pressed: { opacity: 0.7 },
});
