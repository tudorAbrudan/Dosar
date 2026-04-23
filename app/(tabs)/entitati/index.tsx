import { useState, useCallback, useMemo, useRef } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  View as RNView,
  Text as RNText,
  TextInput,
  Platform,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { primary } from '@/theme/colors';
import { useEntities } from '@/hooks/useEntities';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import type { EntityType, Person, Property, Vehicle, Card, Animal, Company } from '@/types';

type AnyEntity = Person | Property | Vehicle | Card | Animal | Company;
type EntityTab = EntityType | 'all';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type TypedEntity = { item: AnyEntity; entityType: EntityType };

const ALL_TABS: { key: EntityTab; label: string; icon: IoniconName }[] = [
  { key: 'all', label: 'Toate', icon: 'apps-outline' },
  { key: 'person', label: 'Persoane', icon: 'person-outline' },
  { key: 'property', label: 'Proprietăți', icon: 'home-outline' },
  { key: 'vehicle', label: 'Vehicule', icon: 'car-outline' },
  { key: 'card', label: 'Carduri', icon: 'card-outline' },
  { key: 'animal', label: 'Animale', icon: 'paw-outline' },
  { key: 'company', label: 'Firme', icon: 'business-outline' },
];

const ENTITY_ICON: Record<EntityType, IoniconName> = {
  person: 'person',
  property: 'home',
  vehicle: 'car',
  card: 'card',
  animal: 'paw',
  company: 'business',
};

const ENTITY_ICON_BG: Record<EntityType, string> = {
  person: '#E3F2FD',
  property: '#E8F5E9',
  vehicle: '#FFF3E0',
  card: '#F3E5F5',
  animal: '#FFF3E0',
  company: '#E8EAF6',
};

const ENTITY_ICON_COLOR: Record<EntityType, string> = {
  person: '#1565C0',
  property: '#2E7D32',
  vehicle: '#E65100',
  card: '#7B1FA2',
  animal: '#E65100',
  company: '#283593',
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
    loading,
    error,
    refresh,
    deletePerson,
    deleteProperty,
    deleteVehicle,
    deleteCard,
    deleteAnimal,
    deleteCompany,
  } = useEntities();

  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      refresh();
    }, [])
  );

  const allTyped: TypedEntity[] = useMemo(
    () => [
      ...persons.map(e => ({ item: e as AnyEntity, entityType: 'person' as EntityType })),
      ...properties.map(e => ({ item: e as AnyEntity, entityType: 'property' as EntityType })),
      ...vehicles.map(e => ({ item: e as AnyEntity, entityType: 'vehicle' as EntityType })),
      ...cards.map(e => ({ item: e as AnyEntity, entityType: 'card' as EntityType })),
      ...animals.map(e => ({ item: e as AnyEntity, entityType: 'animal' as EntityType })),
      ...companies.map(e => ({ item: e as AnyEntity, entityType: 'company' as EntityType })),
    ],
    [persons, properties, vehicles, cards, animals, companies]
  );

  const rawTyped: TypedEntity[] = useMemo(
    () => (tab === 'all' ? allTyped : allTyped.filter(e => e.entityType === tab)),
    [tab, allTyped]
  );

  const typedList: TypedEntity[] = useMemo(() => {
    if (!searchQuery.trim()) return rawTyped;
    const q = searchQuery.trim().toLowerCase();
    return rawTyped.filter(
      ({ item }) =>
        ('name' in item && typeof item.name === 'string' && item.name.toLowerCase().includes(q)) ||
        ('nickname' in item &&
          typeof item.nickname === 'string' &&
          item.nickname.toLowerCase().includes(q))
    );
  }, [rawTyped, searchQuery]);

  const deleteEntity = (id: string, name: string, entityType: EntityType) => {
    Alert.alert('Ștergere', `Ștergi „${name}"?`, [
      { text: 'Anulare', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          try {
            if (entityType === 'person') await deletePerson(id);
            else if (entityType === 'property') await deleteProperty(id);
            else if (entityType === 'vehicle') await deleteVehicle(id);
            else if (entityType === 'animal') await deleteAnimal(id);
            else if (entityType === 'company') await deleteCompany(id);
            else await deleteCard(id);
            refresh();
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge');
          }
        },
      },
    ]);
  };

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
                  color={isActive ? '#fff' : C.textSecondary}
                  style={styles.chipIcon}
                />
                <RNText
                  style={[
                    styles.chipText,
                    { color: isActive ? '#fff' : C.text },
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
        <RNView style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color="#E53935" />
          <RNText style={styles.errorText}>{error}</RNText>
        </RNView>
      ) : null}

      {/* ── Entity list ── */}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          typedList.length === 0 && styles.scrollContentEmpty,
        ]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {!error && typedList.length === 0 && !loading ? (
          <RNView style={styles.emptyWrap}>
            <Ionicons
              name={emptyIconName}
              size={64}
              color={C.textSecondary}
              style={styles.emptyIcon}
            />
            <RNText style={[styles.emptyTitle, { color: C.text }]}>
              {searchQuery.trim() ? 'Niciun rezultat' : 'Nicio entitate'}
            </RNText>
            <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
              {searchQuery.trim()
                ? 'Încearcă alte cuvinte cheie.'
                : 'Apasă + Adaugă pentru a crea prima entitate.'}
            </RNText>
          </RNView>
        ) : (
          typedList.map(({ item, entityType }) => {
            const title = getTitle(item);
            const subtitle = getSubtitle(item, entityType);
            const iconBg = ENTITY_ICON_BG[entityType];
            const iconColor = ENTITY_ICON_COLOR[entityType];
            const iconName = ENTITY_ICON[entityType];
            const vehiclePhoto =
              entityType === 'vehicle' ? (item as Vehicle).photo_uri : undefined;

            if (vehiclePhoto) {
              const v = item as Vehicle;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => router.push(`/(tabs)/entitati/${item.id}`)}
                  onLongPress={() => deleteEntity(item.id, title, entityType)}
                  android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
                  style={({ pressed }) => [
                    styles.vehicleCard,
                    pressed && styles.cardPressed,
                  ]}
                >
                  <Image source={{ uri: vehiclePhoto }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  <LinearGradient
                    colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
                    style={StyleSheet.absoluteFill}
                  />
                  <RNView style={styles.vehicleCardText}>
                    <RNText style={styles.vehicleName} numberOfLines={1}>
                      {v.name}
                    </RNText>
                    {v.plate_number ? (
                      <RNText style={styles.vehiclePlate} numberOfLines={1}>
                        {v.plate_number}
                      </RNText>
                    ) : null}
                  </RNView>
                </Pressable>
              );
            }

            return (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.card,
                  { backgroundColor: C.card, shadowColor: C.cardShadow },
                  pressed && styles.cardPressed,
                ]}
                onPress={() => router.push(`/(tabs)/entitati/${item.id}`)}
                onLongPress={() => deleteEntity(item.id, title, entityType)}
                android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
              >
                <RNView style={[styles.iconWrap, { backgroundColor: iconBg }]}>
                  <Ionicons name={iconName} size={22} color={iconColor} />
                </RNView>
                <RNView style={styles.cardContent}>
                  <RNText style={[styles.cardTitle, { color: C.text }]} numberOfLines={1}>
                    {title}
                  </RNText>
                  {subtitle && (
                    <RNText style={[styles.cardSub, { color: C.textSecondary }]} numberOfLines={1}>
                      {subtitle}
                    </RNText>
                  )}
                </RNView>
                <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
              </Pressable>
            );
          })
        )}
      </ScrollView>

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
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 34,
  },
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
  chipTextActive: { color: '#fff', fontWeight: '600' },

  // Error
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 12,
    marginTop: 4,
    padding: 10,
    backgroundColor: '#FFEBEE',
    borderRadius: 8,
  },
  errorText: { color: '#E53935', fontSize: 13, flex: 1 },

  // Scroll
  scroll: { flex: 1 },
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

  // Card
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  cardSub: {
    fontSize: 12,
    lineHeight: 17,
  },

  // Vehicle photo card
  vehicleCard: {
    height: 90,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 12,
    justifyContent: 'flex-end',
    padding: 12,
    backgroundColor: '#000',
  },
  vehicleCardText: {
    position: 'relative',
    zIndex: 1,
  },
  vehicleName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  vehiclePlate: {
    fontSize: 12,
    marginTop: 2,
    color: 'rgba(255,255,255,0.85)',
  },
});
