import { useState, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  View as RNView,
  Text as RNText,
  TextInput,
  Platform,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { primary, statusColors, onPrimary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { useEntities } from '@/hooks/useEntities';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { DraggableEntityList } from '@/components/DraggableEntityList';
import { EntityListCard } from '@/components/entity/EntityListCard';
import { VehiclePhotoCard } from '@/components/entity/VehiclePhotoCard';
import type { EntityRef } from '@/services/entityOrder';
import type { EntityType, Person, Property, Vehicle, Card, Animal, Company } from '@/types';

type AnyEntity = Person | Property | Vehicle | Card | Animal | Company;
type EntityTab = EntityType | 'all';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type TypedEntity = { item: AnyEntity; entityType: EntityType };

// UI-specific mapping: label-uri la PLURAL pentru tab-uri (diferite de ENTITY_TYPE_LABELS
// care sunt singular), plus icon-uri Ionicons specifice fiecărui tip.
// check-hardcoded-entities-disable-next-cluster
const ALL_TABS: { key: EntityTab; label: string; icon: IoniconName }[] = [
  { key: 'all', label: 'Toate', icon: 'apps-outline' },
  { key: 'person', label: 'Persoane', icon: 'person-outline' },
  { key: 'property', label: 'Proprietăți', icon: 'home-outline' },
  { key: 'vehicle', label: 'Vehicule', icon: 'car-outline' },
  { key: 'card', label: 'Carduri', icon: 'card-outline' },
  { key: 'animal', label: 'Animale', icon: 'paw-outline' },
  { key: 'company', label: 'Firme', icon: 'business-outline' },
];

// check-hardcoded-entities-disable-next-cluster
const ENTITY_ICON: Record<EntityType, IoniconName> = {
  person: 'person',
  property: 'home',
  vehicle: 'car',
  card: 'card',
  animal: 'paw',
  company: 'business',
  medical_record: 'medkit',
};

// check-hardcoded-entities-disable-next-cluster
const ENTITY_ICON_BG: Record<EntityType, string> = {
  person: iconColors.info.bg,
  property: iconColors.primary.bg,
  vehicle: iconColors.warning.bg,
  card: iconColors.purple.bg,
  animal: iconColors.warning.bg,
  company: iconColors.indigo.bg,
  medical_record: iconColors.primary.bg,
};

// check-hardcoded-entities-disable-next-cluster
const ENTITY_ICON_COLOR: Record<EntityType, string> = {
  person: iconColors.info.fg,
  property: iconColors.primary.fg,
  vehicle: iconColors.warning.fg,
  card: iconColors.purple.fg,
  animal: iconColors.warning.fg,
  company: iconColors.indigo.fg,
  medical_record: iconColors.primary.fg,
};

export default function EntitatiListScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const [tab, setTab] = useState<EntityTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const { visibleEntityTypes } = useVisibilitySettings();
  const TABS = ALL_TABS.filter(
    t => t.key === 'all' || visibleEntityTypes.includes(t.key as EntityType)
  );
  const {
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    globalOrderMap,
    loading,
    error,
    refresh,
    reorder,
  } = useEntities();

  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      refresh();
    }, [])
  );

  const allTyped: TypedEntity[] = useMemo(() => {
    // check-hardcoded-entities-disable-next-cluster
    // Ordinea explicită: persons → property → vehicle → card → animal → company.
    // Nu derivăm din ALL_ENTITY_TYPES ca să păstrăm ordinea UI istorică stabilă.
    const TYPE_RANK: Record<EntityType, number> = {
      person: 1,
      property: 2,
      vehicle: 3,
      card: 4,
      animal: 5,
      company: 6,
      medical_record: 7,
    };
    const combined: TypedEntity[] = [
      ...persons.map(e => ({ item: e as AnyEntity, entityType: 'person' as EntityType })),
      ...properties.map(e => ({ item: e as AnyEntity, entityType: 'property' as EntityType })),
      ...vehicles.map(e => ({ item: e as AnyEntity, entityType: 'vehicle' as EntityType })),
      ...cards.map(e => ({ item: e as AnyEntity, entityType: 'card' as EntityType })),
      ...animals.map(e => ({ item: e as AnyEntity, entityType: 'animal' as EntityType })),
      ...companies.map(e => ({ item: e as AnyEntity, entityType: 'company' as EntityType })),
    ];
    return combined.sort((a, b) => {
      const sa = globalOrderMap.get(`${a.entityType}:${a.item.id}`);
      const sb = globalOrderMap.get(`${b.entityType}:${b.item.id}`);
      if (sa !== undefined && sb !== undefined) return sa - sb;
      if (sa !== undefined) return -1;
      if (sb !== undefined) return 1;
      return TYPE_RANK[a.entityType] - TYPE_RANK[b.entityType];
    });
  }, [persons, properties, vehicles, cards, animals, companies, globalOrderMap]);

  const rawTyped: TypedEntity[] = useMemo(
    () => (tab === 'all' ? allTyped : allTyped.filter(e => e.entityType === tab)),
    [tab, allTyped]
  );

  const typedList: TypedEntity[] = useMemo(() => {
    if (!searchQuery.trim()) return rawTyped;
    const q = searchQuery.trim().toLowerCase();
    return rawTyped.filter(({ item }) => {
      return (
        ('name' in item && typeof item.name === 'string' && item.name.toLowerCase().includes(q)) ||
        ('nickname' in item &&
          typeof item.nickname === 'string' &&
          item.nickname.toLowerCase().includes(q))
      );
    });
  }, [rawTyped, searchQuery]);

  const getTitle = (item: AnyEntity): string => {
    if ('name' in item && item.name) return item.name as string;
    if ('nickname' in item && item.nickname) return item.nickname as string;
    return '—';
  };

  const getSubtitle = (item: AnyEntity, entityType: EntityType): string | null => {
    if (entityType === 'card' && 'last4' in item && item.last4) return `•••• ${item.last4}`;
    if (entityType === 'vehicle' && 'type' in item && item.type) return item.type as string;
    if (entityType === 'animal' && 'species' in item && item.species) return item.species as string;
    if (entityType === 'company' && 'cui' in item && item.cui) return `CUI: ${item.cui}`;
    return null;
  };

  const tabCount = rawTyped.length;
  const subtitleText = `${tabCount} ${
    tab === 'all'
      ? 'entități'
      : tab === 'person'
        ? 'persoane'
        : tab === 'property'
          ? 'proprietăți'
          : tab === 'vehicle'
            ? 'vehicule'
            : tab === 'animal'
              ? 'animale'
              : tab === 'company'
                ? 'firme'
                : 'carduri'
  }`;

  const emptyIconName: IoniconName =
    tab === 'all' ? 'people-outline' : ENTITY_ICON[tab as EntityType];

  // Drag & drop reorder: lista vizibilă poate fi filtrată pe tab. Merge-uim noua
  // ordine vizibilă înapoi în ordinea globală (allTyped), apoi apelăm reorder().
  const handleReorder = useCallback(
    (newVisibleOrder: TypedEntity[]) => {
      let newGlobalOrder: TypedEntity[];
      if (tab === 'all') {
        newGlobalOrder = newVisibleOrder;
      } else {
        const matchingSlots: number[] = [];
        allTyped.forEach((e, i) => {
          if (e.entityType === tab) matchingSlots.push(i);
        });
        const merged = [...allTyped];
        newVisibleOrder.forEach((item, idx) => {
          const slot = matchingSlots[idx];
          if (slot !== undefined) merged[slot] = item;
        });
        newGlobalOrder = merged;
      }
      const refs: EntityRef[] = newGlobalOrder.map(e => ({
        entity_type: e.entityType,
        entity_id: e.item.id,
      }));
      reorder(refs);
    },
    [tab, allTyped, reorder]
  );

  const isSearching = !!searchQuery.trim();

  const renderCard = (typed: TypedEntity, info: { isActive: boolean; onLongPress: () => void }) => {
    const { item, entityType } = typed;
    const vehiclePhoto = entityType === 'vehicle' ? (item as Vehicle).photo_uri : undefined;

    if (vehiclePhoto) {
      const v = item as Vehicle;
      return (
        <VehiclePhotoCard
          photoUri={vehiclePhoto}
          name={v.name}
          plateNumber={v.plate_number}
          isActive={info.isActive}
          onPress={() => router.push(`/(tabs)/entitati/${item.id}`)}
          onLongPress={info.onLongPress}
        />
      );
    }

    return (
      <EntityListCard
        title={getTitle(item)}
        subtitle={getSubtitle(item, entityType)}
        icon={ENTITY_ICON[entityType]}
        iconBg={ENTITY_ICON_BG[entityType]}
        iconColor={ENTITY_ICON_COLOR[entityType]}
        scheme={scheme}
        isActive={info.isActive}
        onPress={() => router.push(`/(tabs)/entitati/${item.id}`)}
        onLongPress={info.onLongPress}
      />
    );
  };

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      {/* ── Custom Header ── */}
      <RNView
        style={[styles.header, { backgroundColor: C.background, paddingTop: insets.top + 8 }]}
      >
        <RNView style={styles.headerLeft}>
          <RNText style={[styles.headerSub, { color: C.textSecondary }]}>{subtitleText}</RNText>
        </RNView>
      </RNView>

      {/* ── Search bar ── */}
      <RNView style={[styles.searchWrap, { backgroundColor: C.card, borderColor: C.border }]}>
        <Ionicons name="search" size={20} color={C.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: C.text }]}
          placeholder="Caută entitate..."
          placeholderTextColor={C.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </RNView>

      {/* ── Tabs as chips ── */}
      <RNView style={styles.chipsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          {TABS.map(({ key, label, icon }) => {
            const isActive = tab === key;
            return (
              <Pressable
                key={key}
                style={[
                  styles.chip,
                  { borderColor: C.border },
                  isActive && { backgroundColor: primary, borderColor: primary },
                ]}
                onPress={() => setTab(key)}
              >
                <Ionicons
                  name={icon}
                  size={13}
                  color={isActive ? onPrimary : C.textSecondary}
                  style={styles.chipIcon}
                />
                <RNText
                  style={[
                    styles.chipText,
                    { color: isActive ? onPrimary : C.text },
                    isActive && styles.chipTextActive,
                  ]}
                >
                  {label}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>
      </RNView>

      {/* ── Error banner ── */}
      {error ? (
        <RNView
          style={[
            styles.errorBanner,
            {
              backgroundColor:
                scheme === 'dark' ? statusColors.criticalSurfaceDark : iconColors.danger.bg,
              borderColor: statusColors.critical,
              borderWidth: StyleSheet.hairlineWidth,
            },
          ]}
        >
          <Ionicons name="alert-circle-outline" size={16} color={statusColors.critical} />
          <RNText style={[styles.errorText, { color: statusColors.critical }]}>{error}</RNText>
        </RNView>
      ) : null}

      {/* ── Entity list ── */}
      <DraggableEntityList<TypedEntity>
        data={typedList}
        keyExtractor={t => t.item.id}
        renderItem={renderCard}
        onReorder={handleReorder}
        scrollRef={scrollRef}
        disabled={isSearching}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.scrollContent,
          typedList.length === 0 && styles.scrollContentEmpty,
        ]}
        emptyComponent={
          !error && !loading ? (
            <RNView style={styles.emptyWrap}>
              <Ionicons
                name={emptyIconName}
                size={64}
                color={C.textSecondary}
                style={styles.emptyIcon}
              />
              <RNText style={[styles.emptyTitle, { color: C.text }]}>
                {isSearching ? 'Niciun rezultat' : 'Nicio entitate'}
              </RNText>
              <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
                {isSearching
                  ? 'Încearcă alte cuvinte cheie.'
                  : 'Apasă + Adaugă pentru a crea prima entitate.'}
              </RNText>
            </RNView>
          ) : null
        }
      />

      <BottomActionBar
        label="Adaugă entitate"
        icon={<Ionicons name="add" size={20} color="#fff" />}
        onPress={() => router.push('/(tabs)/entitati/add')}
      />
    </RNView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerLeft: { gap: 2 },
  headerSub: {
    fontSize: 14,
    lineHeight: 18,
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 6,
    marginBottom: 2,
    borderRadius: 12,
    borderWidth: 1,
    height: 44,
    paddingHorizontal: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 3,
      },
      android: { elevation: 1 },
    }),
  },
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: '100%',
  },

  // Chips
  chipsRow: {
    height: 40,
    flexShrink: 0,
    overflow: 'hidden',
  },
  chipsContent: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 13,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipIcon: { marginRight: 4 },
  chipText: { fontSize: 13, lineHeight: 18 },
  chipTextActive: { color: onPrimary, fontWeight: '600' },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 4,
    padding: 10,
    borderRadius: 8,
  },
  errorText: { fontSize: 13, flex: 1 },

  // Scroll
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 16,
  },
  scrollContentEmpty: { flexGrow: 1 },

  // Empty state
  emptyWrap: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: 32,
  },
  emptyIcon: { marginBottom: 16, opacity: 0.4 },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    opacity: 0.8,
  },
});
