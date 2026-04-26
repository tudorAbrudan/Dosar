import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { dark, light, primary } from '@/theme/colors';
import { computeFuelIntervalStats, type FuelIntervalStats } from '@/services/fuel';

type RangeKey = 'all' | '30d' | '90d' | '6m' | '12m' | 'ytd';

interface RangeOption {
  key: RangeKey;
  label: string;
}

const RANGE_OPTIONS: RangeOption[] = [
  { key: '30d', label: '30 zile' },
  { key: '90d', label: '90 zile' },
  { key: '6m', label: '6 luni' },
  { key: '12m', label: '12 luni' },
  { key: 'ytd', label: 'Anul curent' },
  { key: 'all', label: 'Toate' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function rangeFromKey(key: RangeKey): string | undefined {
  if (key === 'all') return undefined;
  const d = new Date();
  if (key === 'ytd') {
    return `${d.getFullYear()}-01-01`;
  }
  if (key === '30d') d.setDate(d.getDate() - 30);
  else if (key === '90d') d.setDate(d.getDate() - 90);
  else if (key === '6m') d.setMonth(d.getMonth() - 6);
  else if (key === '12m') d.setMonth(d.getMonth() - 12);
  return d.toISOString().slice(0, 10);
}

function formatRO(date: string): string {
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;
  return `${d}.${m}.${y}`;
}

export default function FuelStatsScreen() {
  const { vehicleId } = useLocalSearchParams<{ vehicleId: string; vehicleName?: string }>();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [range, setRange] = useState<RangeKey>('30d');
  const [stats, setStats] = useState<FuelIntervalStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (key: RangeKey) => {
      if (!vehicleId) return;
      setLoading(true);
      try {
        const fromIso = rangeFromKey(key);
        const result = await computeFuelIntervalStats(vehicleId, fromIso);
        setStats(result);
      } finally {
        setLoading(false);
      }
    },
    [vehicleId]
  );

  useFocusEffect(
    useCallback(() => {
      load(range);
    }, [load, range])
  );

  if (!vehicleId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>ID vehicul lipsă.</Text>
      </View>
    );
  }

  function selectRange(key: RangeKey) {
    setRange(key);
    load(key);
  }

  const fromLabel = stats?.fromIso ? formatRO(stats.fromIso) : '—';
  const toLabel = stats ? formatRO(stats.toIso) : formatRO(todayIso());

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.rangeHint, { color: palette.textSecondary }]}>
          {fromLabel} – {toLabel}
        </Text>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {RANGE_OPTIONS.map(opt => {
            const active = opt.key === range;
            return (
              <Pressable
                key={opt.key}
                onPress={() => selectRange(opt.key)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    borderColor: active ? primary : palette.border,
                    backgroundColor: active ? primary : 'transparent',
                  },
                  pressed && styles.chipPressed,
                ]}
              >
                <Text
                  style={[styles.chipText, { color: active ? '#fff' : palette.textSecondary }]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading && <ActivityIndicator color={primary} style={{ marginVertical: 24 }} />}

        {!loading && stats && stats.recordCount === 0 && (
          <Text style={[styles.empty, { color: palette.textSecondary }]}>
            Nicio înregistrare în intervalul selectat.
          </Text>
        )}

        {!loading && stats && stats.recordCount > 0 && (
          <View style={[styles.card, { backgroundColor: palette.card }]}>
            <Row
              label="Înregistrări"
              value={`${stats.recordCount}`}
              palette={palette}
            />
            <Row
              label="Plinuri complete"
              value={`${stats.fillupCount}`}
              palette={palette}
            />
            <Row
              label="Distanță parcursă"
              value={
                stats.totalDistance !== undefined
                  ? `${stats.totalDistance.toLocaleString('ro-RO')} km`
                  : '—'
              }
              palette={palette}
            />
            <Row
              label="Cost total"
              value={`${stats.totalCost.toFixed(2)} RON`}
              palette={palette}
            />
            <Row
              label="Cost / km"
              value={
                stats.costPerKm !== undefined ? `${stats.costPerKm.toFixed(2)} RON/km` : '—'
              }
              palette={palette}
            />
            <Row
              label="Litri totali"
              value={`${stats.totalLiters.toFixed(1)} L`}
              palette={palette}
            />
            <Row
              label="Consum mediu"
              value={
                stats.avgConsumptionL100 !== undefined
                  ? `${stats.avgConsumptionL100.toFixed(2)} L/100km`
                  : '—'
              }
              palette={palette}
              highlight
            />
            <Row
              label="Preț mediu / litru"
              value={
                stats.avgPricePerLiter !== undefined
                  ? `${stats.avgPricePerLiter.toFixed(2)} RON/L`
                  : '—'
              }
              palette={palette}
            />
            <Row
              label="Litri / alimentare"
              value={
                stats.avgLitersPerFillup !== undefined
                  ? `${stats.avgLitersPerFillup.toFixed(1)} L`
                  : '—'
              }
              palette={palette}
            />
            <Row
              label="Distanță între plinuri"
              value={
                stats.avgKmBetweenFillups !== undefined
                  ? `${Math.round(stats.avgKmBetweenFillups).toLocaleString('ro-RO')} km`
                  : '—'
              }
              palette={palette}
              isLast
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

interface RowProps {
  label: string;
  value: string;
  palette: typeof light;
  isLast?: boolean;
  highlight?: boolean;
}

function Row({ label, value, palette, isLast, highlight }: RowProps) {
  return (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
      ]}
    >
      <Text style={[styles.rowLabel, { color: palette.textSecondary }]}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          { color: highlight ? primary : palette.text },
          highlight && styles.rowValueHighlight,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 16, opacity: 0.7, textAlign: 'center' },
  content: { padding: 16, paddingBottom: 32 },

  rangeHint: { fontSize: 13, marginBottom: 10 },

  chipsRow: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipPressed: { opacity: 0.75 },
  chipText: { fontSize: 13, fontWeight: '500' },

  empty: { textAlign: 'center', marginTop: 40, fontSize: 14, fontStyle: 'italic' },

  card: {
    marginTop: 16,
    borderRadius: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: 'transparent',
  },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 15, fontWeight: '600' },
  rowValueHighlight: { fontSize: 17, fontWeight: '700' },
});
