import { useMemo, useState } from 'react';
import { View, FlatList, Pressable, StyleSheet, RefreshControl, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, primaryTint, statusColors } from '@/theme/colors';
import { useMedicalObservations } from '@/hooks/useMedicalObservations';
import { ObservationSparkline } from '@/components/medical/ObservationSparkline';
import { OBSERVATION_CATEGORIES } from '@/types';
import type { MedicalRecordStats } from '@/services/medicalRecord';
import type { ObservationCategory } from '@/types';

interface Props {
  recordId: string;
  stats: MedicalRecordStats | null;
  onChange(): Promise<void>;
}

const CATEGORY_LABELS: Record<ObservationCategory, string> = {
  hematologie: 'Hematologie',
  biochimie: 'Biochimie',
  lipide: 'Lipide',
  tiroidiene: 'Tiroidiene',
  hormonal: 'Hormonal',
  hepatice: 'Hepatice',
  renale: 'Renale',
  urinare: 'Urinare',
  microbiologie: 'Microbiologie',
  imunologie: 'Imunologie',
  altele: 'Altele',
};

export function TimelineTab({ recordId, stats, onChange }: Props) {
  const router = useRouter();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const { groups, needsReviewCount, loading, refresh } = useMedicalObservations(recordId);
  const [filterCategory, setFilterCategory] = useState<ObservationCategory | null>(null);

  const filteredGroups = useMemo(() => {
    if (!filterCategory) return groups;
    return groups.filter(g => g.category === filterCategory);
  }, [groups, filterCategory]);

  // Categorii prezente în datele actuale, ca să nu afișăm chip-uri goale.
  const activeCategories = useMemo(() => {
    const set = new Set<ObservationCategory>();
    for (const g of groups) set.add(g.category);
    return OBSERVATION_CATEGORIES.filter(c => set.has(c));
  }, [groups]);

  const reviewCount = stats?.observations_needs_review ?? needsReviewCount;

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={filteredGroups}
        keyExtractor={g => g.name}
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              refresh();
              onChange();
            }}
            tintColor={primary}
          />
        }
        ListHeaderComponent={
          <View>
            {reviewCount > 0 ? (
              <Pressable
                style={[styles.banner, { backgroundColor: '#FFF3CD', borderColor: '#FFE69C' }]}
                onPress={() => router.push(`/(tabs)/entitati/medical/${recordId}/review`)}
              >
                <Ionicons name="warning-outline" size={18} color={statusColors.warning} />
                <Text style={[styles.bannerText, { color: '#664D03' }]}>
                  {reviewCount}{' '}
                  {reviewCount === 1
                    ? 'valoare extrasă are nevoie de verificare'
                    : 'valori extrase au nevoie de verificare'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color="#664D03" />
              </Pressable>
            ) : null}

            {activeCategories.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipsRow}
              >
                <CategoryChip
                  label="Toate"
                  active={filterCategory === null}
                  palette={palette}
                  onPress={() => setFilterCategory(null)}
                />
                {activeCategories.map(c => (
                  <CategoryChip
                    key={c}
                    label={CATEGORY_LABELS[c]}
                    active={filterCategory === c}
                    palette={palette}
                    onPress={() => setFilterCategory(c)}
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
        renderItem={({ item }) => {
          const last = item.values[item.values.length - 1];
          return (
            <View
              style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.count, { color: palette.textSecondary }]}>
                  {item.values.length} {item.values.length === 1 ? 'măsurătoare' : 'măsurători'}
                </Text>
              </View>

              <ObservationSparkline values={item.values} />

              <View style={styles.cardFooter}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.lastValue, { color: palette.text }]}>
                    Ultima: {last?.value ?? '—'}
                    {item.unit ? ` ${item.unit}` : ''}
                  </Text>
                  {last?.observed_at ? (
                    <Text style={[styles.dateText, { color: palette.textSecondary }]}>
                      {last.observed_at}
                    </Text>
                  ) : null}
                </View>
                {item.ref_min || item.ref_max ? (
                  <Text style={[styles.refText, { color: palette.textSecondary }]}>
                    Ref: {item.ref_min ?? '?'}–{item.ref_max ?? '?'}
                  </Text>
                ) : null}
              </View>

              <Text style={[styles.category, { color: palette.textSecondary }]}>
                {CATEGORY_LABELS[item.category]}
              </Text>
            </View>
          );
        }}
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <Ionicons name="pulse-outline" size={48} color={palette.textSecondary} />
              <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
                {filterCategory
                  ? 'Nicio observație în această categorie.'
                  : 'Nicio observație extrasă încă.'}
              </Text>
              {!filterCategory ? (
                <Text style={[styles.emptyHint, { color: palette.textSecondary }]}>
                  Adaugă documente medicale în tab-ul Documente pentru extragere automată.
                </Text>
              ) : null}
            </View>
          )
        }
      />
    </View>
  );
}

interface ChipProps {
  label: string;
  active: boolean;
  onPress(): void;
  palette: typeof light;
}

function CategoryChip({ label, active, onPress, palette }: ChipProps) {
  return (
    <Pressable
      style={[
        styles.chip,
        {
          backgroundColor: active ? primaryTint : palette.surface,
          borderColor: active ? primary : palette.border,
        },
      ]}
      onPress={onPress}
    >
      <Text
        style={{
          color: active ? primary : palette.text,
          fontWeight: active ? '600' : '400',
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 13 },
  chipsRow: { paddingHorizontal: 12, paddingVertical: 12, gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  name: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 12 },
  count: { fontSize: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  lastValue: { fontSize: 15, fontWeight: '600' },
  dateText: { fontSize: 12, marginTop: 2 },
  refText: { fontSize: 12 },
  category: { fontSize: 11, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 24 },
  emptyText: { fontSize: 15, marginTop: 12, textAlign: 'center' },
  emptyHint: { fontSize: 13, marginTop: 8, textAlign: 'center' },
});
