import { useMemo, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  FlatList,
  RefreshControl,
  Alert,
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
import { useDocuments } from '@/hooks/useDocuments';
import { useEntities } from '@/hooks/useEntities';
import { DOCUMENT_TYPE_LABELS, getDocumentLabel } from '@/types';
import type { DocumentType } from '@/types';
import type { Document } from '@/types';
import { useCustomTypes } from '@/hooks/useCustomTypes';

// ─── Constants ────────────────────────────────────────────────────────────────

const DOCUMENT_TYPES: { value: DocumentType | 'toate'; label: string }[] = [
  { value: 'toate', label: 'Toate' },
  ...Object.entries(DOCUMENT_TYPE_LABELS)
    .filter(([value]) => value !== 'custom')
    .map(([value, label]) => ({ value: value as DocumentType, label })),
];

const EXPIRING_DAYS = 30;

// ─── Helpers: icons & colors per document type ────────────────────────────────

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const DOC_ICON: Record<DocumentType, IoniconName> = {
  buletin: 'id-card',
  pasaport: 'book',
  permis_auto: 'car',
  talon: 'document-text',
  carte_auto: 'document',
  rca: 'shield-checkmark',
  casco: 'shield-half',
  itp: 'checkmark-circle',
  vigneta: 'ribbon',
  act_proprietate: 'home',
  cadastru: 'map',
  factura: 'receipt',
  bon_combustibil: 'flame',
  card: 'card',
  garantie: 'ribbon-outline',
  medicament: 'medkit-outline',
  pad: 'home-outline',
  stingator_incendiu: 'flame-outline',
  abonament: 'repeat-outline',
  index_utilitati: 'speedometer-outline',
  vaccin_animal: 'fitness-outline',
  deparazitare: 'bug-outline',
  vizita_vet: 'paw-outline',
  altul: 'document-outline',
  custom: 'document-outline',
};

const DOC_ICON_BG: Record<DocumentType, string> = {
  buletin: '#E3F2FD',
  pasaport: '#E8EAF6',
  permis_auto: '#FFF3E0',
  talon: '#E0F2F1',
  carte_auto: '#E0F2F1',
  rca: '#FCE4EC',
  casco: '#FCE4EC',
  itp: '#F3E5F5',
  vigneta: '#FFF8E1',
  act_proprietate: '#E8F5E9',
  cadastru: '#E8F5E9',
  factura: '#FFF3E0',
  bon_combustibil: '#FFF3E0',
  card: '#F3E5F5',
  garantie: '#E8F5E9',
  medicament: '#FCE4EC',
  pad: '#E3F2FD',
  stingator_incendiu: '#FCE4EC',
  abonament: '#F3E5F5',
  index_utilitati: '#E0F2F1',
  vaccin_animal: '#E8F5E9',
  deparazitare: '#FFF8E1',
  vizita_vet: '#E8EAF6',
  altul: '#F5F5F5',
  custom: '#F5F5F5',
};

const DOC_ICON_COLOR: Record<DocumentType, string> = {
  buletin: '#1565C0',
  pasaport: '#283593',
  permis_auto: '#E65100',
  talon: '#00695C',
  carte_auto: '#00897B',
  rca: '#C62828',
  casco: '#AD1457',
  itp: '#6A1B9A',
  vigneta: '#F57F17',
  act_proprietate: '#2E7D32',
  cadastru: '#388E3C',
  factura: '#BF360C',
  bon_combustibil: '#E65100',
  card: '#7B1FA2',
  garantie: '#2E7D32',
  medicament: '#C62828',
  pad: '#1565C0',
  stingator_incendiu: '#BF360C',
  abonament: '#7B1FA2',
  index_utilitati: '#00695C',
  vaccin_animal: '#388E3C',
  deparazitare: '#F57F17',
  vizita_vet: '#283593',
  altul: '#757575',
  custom: '#757575',
};

// ─── Entity kind → icon ───────────────────────────────────────────────────────

const ENTITY_ICON: Record<string, IoniconName> = {
  person_id: 'person',
  vehicle_id: 'car-outline',
  property_id: 'home-outline',
  card_id: 'card-outline',
  animal_id: 'paw-outline',
};

// ─── Pure logic helpers ───────────────────────────────────────────────────────

function isExpiringSoon(doc: Document, days: number): boolean {
  if (!doc.expiry_date) return false;
  const exp = new Date(doc.expiry_date).getTime();
  const limit = Date.now() + days * 24 * 60 * 60 * 1000;
  return exp <= limit && exp >= Date.now() - 7 * 24 * 60 * 60 * 1000;
}

function getExpiryInfo(doc: Document): {
  label: string;
  bg: string;
  fg: string;
} | null {
  if (!doc.expiry_date) return null;
  const exp = new Date(doc.expiry_date).getTime();
  const now = Date.now();
  const daysLeft = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));

  if (daysLeft < 0) {
    return { label: 'Expirat', bg: '#E53935', fg: '#fff' };
  }
  if (daysLeft <= 30) {
    return { label: `${daysLeft}z`, bg: '#F57C00', fg: '#fff' };
  }
  return { label: formatShortDate(doc.expiry_date), bg: '#9EB56722', fg: '#9EB567' };
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Ian', 'Feb', 'Mar', 'Apr', 'Mai', 'Iun', 'Iul', 'Aug', 'Sep', 'Oct', 'Noi', 'Dec'];
  return `${day} ${months[d.getMonth()]}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface DocumentCardProps {
  doc: Document;
  entityName: string | null;
  entityKind: string | null;
  label: string;
  scheme: 'light' | 'dark';
  onPress: () => void;
  onLongPress: () => void;
}

function DocumentCard({
  doc,
  entityName,
  entityKind,
  label,
  scheme,
  onPress,
  onLongPress,
}: DocumentCardProps) {
  const C = Colors[scheme];
  const iconBg = DOC_ICON_BG[doc.type] ?? '#F5F5F5';
  const iconColor = DOC_ICON_COLOR[doc.type] ?? '#757575';
  const iconName = DOC_ICON[doc.type] ?? 'document-outline';
  const expiry = getExpiryInfo(doc);
  const entityIconName: IoniconName = entityKind
    ? (ENTITY_ICON[entityKind] ?? 'ellipse-outline')
    : 'ellipse-outline';

  return (
    <Pressable
      style={({ pressed }) => [
        cardStyles.card,
        { backgroundColor: C.card, shadowColor: C.cardShadow },
        pressed && cardStyles.cardPressed,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
    >
      {/* Left: type icon */}
      <RNView style={[cardStyles.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={iconName} size={22} color={iconColor} />
      </RNView>

      {/* Middle: text */}
      <RNView style={cardStyles.content}>
        <RNText
          style={[cardStyles.title, { color: C.text }]}
          numberOfLines={1}
        >
          {label}
        </RNText>

        {entityName && (
          <RNView style={cardStyles.entityRow}>
            <Ionicons
              name={entityIconName}
              size={11}
              color={C.textSecondary}
              style={cardStyles.entityIcon}
            />
            <RNText
              style={[cardStyles.entityText, { color: C.textSecondary }]}
              numberOfLines={1}
            >
              {entityName}
            </RNText>
          </RNView>
        )}

        {doc.note ? (
          <RNText
            style={[cardStyles.note, { color: C.textSecondary }]}
            numberOfLines={1}
          >
            {doc.note}
          </RNText>
        ) : null}
      </RNView>

      {/* Right: expiry badge + chevron */}
      <RNView style={cardStyles.right}>
        {expiry && (
          <RNView style={[cardStyles.expiryBadge, { backgroundColor: expiry.bg }]}>
            <RNText style={[cardStyles.expiryText, { color: expiry.fg }]}>
              {expiry.label}
            </RNText>
          </RNView>
        )}
        <Ionicons name="chevron-forward" size={16} color={C.textSecondary} style={cardStyles.chevron} />
      </RNView>
    </Pressable>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
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
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  entityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  entityIcon: {
    marginTop: 1,
  },
  entityText: {
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
  note: {
    fontSize: 12,
    lineHeight: 17,
    fontStyle: 'italic',
  },
  right: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
    gap: 4,
    flexShrink: 0,
  },
  expiryBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  expiryText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
  chevron: {
    marginTop: 2,
  },
});

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({
  isFiltered,
  scheme,
}: {
  isFiltered: boolean;
  scheme: 'light' | 'dark';
}) {
  const C = Colors[scheme];
  return (
    <RNView style={emptyStyles.wrap}>
      <Ionicons name="document-outline" size={64} color={C.textSecondary} style={emptyStyles.icon} />
      <RNText style={[emptyStyles.title, { color: C.text }]}>
        {isFiltered ? 'Niciun rezultat' : 'Niciun document'}
      </RNText>
      <RNText style={[emptyStyles.sub, { color: C.textSecondary }]}>
        {isFiltered
          ? 'Încearcă alte filtre sau șterge căutarea.'
          : 'Apasă + pentru a adăuga primul tău document.'}
      </RNText>
    </RNView>
  );
}

const emptyStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: 32,
  },
  icon: {
    marginBottom: 16,
    opacity: 0.4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  sub: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    opacity: 0.8,
  },
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DocumenteListScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();

  const { documents, loading, error, refresh, deleteDocument } = useDocuments();
  const { persons, properties, vehicles, cards, animals } = useEntities();
  const { customTypes } = useCustomTypes();

  const [filterType, setFilterType] = useState<DocumentType | 'toate'>('toate');
  const [filterEntity, setFilterEntity] = useState<{ kind: string; id: string } | null>(null);
  const [onlyExpiring, setOnlyExpiring] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [])
  );

  // ── Entity maps ──────────────────────────────────────────────────────────────
  const personMap = useMemo(() => new Map(persons.map(p => [p.id, p.name])), [persons]);
  const propertyMap = useMemo(() => new Map(properties.map(p => [p.id, p.name])), [properties]);
  const vehicleMap = useMemo(() => new Map(vehicles.map(v => [v.id, v.name])), [vehicles]);
  const cardMap = useMemo(
    () => new Map(cards.map(c => [c.id, c.nickname || c.last4 || c.id])),
    [cards]
  );
  const animalMap = useMemo(() => new Map(animals.map(a => [a.id, a.name])), [animals]);

  function getEntityName(doc: Document): string | null {
    if (doc.person_id) return personMap.get(doc.person_id) ?? null;
    if (doc.vehicle_id) return vehicleMap.get(doc.vehicle_id) ?? null;
    if (doc.property_id) return propertyMap.get(doc.property_id) ?? null;
    if (doc.card_id) return cardMap.get(doc.card_id) ?? null;
    if (doc.animal_id) return animalMap.get(doc.animal_id) ?? null;
    return null;
  }

  function getEntityKind(doc: Document): string | null {
    if (doc.person_id) return 'person_id';
    if (doc.vehicle_id) return 'vehicle_id';
    if (doc.property_id) return 'property_id';
    if (doc.card_id) return 'card_id';
    if (doc.animal_id) return 'animal_id';
    return null;
  }

  const entityOptions = useMemo(() => {
    const list: { kind: string; id: string; label: string }[] = [];
    persons.forEach(p => list.push({ kind: 'person_id', id: p.id, label: p.name }));
    properties.forEach(p =>
      list.push({ kind: 'property_id', id: p.id, label: p.name })
    );
    vehicles.forEach(v => list.push({ kind: 'vehicle_id', id: v.id, label: v.name }));
    cards.forEach(c =>
      list.push({ kind: 'card_id', id: c.id, label: c.nickname || c.last4 || c.id })
    );
    animals.forEach(a => list.push({ kind: 'animal_id', id: a.id, label: a.name }));
    return list;
  }, [persons, properties, vehicles, cards, animals]);

  // ── Filtering ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = documents;
    if (filterType !== 'toate') list = list.filter(d => d.type === filterType);
    if (filterEntity)
      list = list.filter(
        d =>
          (d as unknown as Record<string, string | undefined>)[filterEntity.kind] ===
          filterEntity.id
      );
    if (onlyExpiring) list = list.filter(d => isExpiringSoon(d, EXPIRING_DAYS));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        d =>
          getDocumentLabel(d, customTypes).toLowerCase().includes(q) ||
          (d.note?.toLowerCase().includes(q) ?? false)
      );
    }
    return list;
  }, [documents, filterType, filterEntity, onlyExpiring, searchQuery]);

  const handleDelete = (doc: Document) => {
    Alert.alert('Ștergere', `Ștergi documentul „${getDocumentLabel(doc, customTypes)}"?`, [
      { text: 'Anulare', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteDocument(doc.id);
            refresh();
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge');
          }
        },
      },
    ]);
  };

  const isFiltered =
    filterType !== 'toate' || filterEntity !== null || onlyExpiring || searchQuery.trim().length > 0;

  // ── Render item ──────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item: doc }: { item: Document }) => (
      <DocumentCard
        doc={doc}
        entityName={getEntityName(doc)}
        entityKind={getEntityKind(doc)}
        label={getDocumentLabel(doc, customTypes)}
        scheme={scheme}
        onPress={() => router.push(`/(tabs)/documente/${doc.id}`)}
        onLongPress={() => handleDelete(doc)}
      />
    ),
    [scheme, personMap, vehicleMap, propertyMap, cardMap, animalMap, customTypes]
  );

  const keyExtractor = useCallback((doc: Document) => doc.id, []);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>

      {/* ── Custom Header ── */}
      <RNView style={[styles.header, { backgroundColor: C.background, paddingTop: insets.top + 8 }]}>
        <RNView style={styles.headerLeft}>
          <RNText style={[styles.headerTitle, { color: C.text }]}>Documente</RNText>
          <RNText style={[styles.headerSub, { color: C.textSecondary }]}>
            {isFiltered && filtered.length !== documents.length
              ? `${filtered.length} din ${documents.length}`
              : `${documents.length} ${documents.length === 1 ? 'document' : 'documente'}`}
          </RNText>
        </RNView>
      </RNView>

      {/* ── Search bar ── */}
      <RNView style={[styles.searchWrap, { backgroundColor: C.card, borderColor: C.border }]}>
        <Ionicons name="search" size={20} color={C.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: C.text }]}
          placeholder="Caută după tip, notă..."
          placeholderTextColor={C.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </RNView>

      {/* ── Type filter chips ── */}
      <RNView style={styles.chipsRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContent}
      >
        {/* "Expiră curând" chip */}
        <Pressable
          style={[
            styles.chip,
            { borderColor: C.border },
            onlyExpiring && { backgroundColor: '#9EB567', borderColor: '#9EB567' },
          ]}
          onPress={() => setOnlyExpiring(!onlyExpiring)}
        >
          <Ionicons
            name="time-outline"
            size={13}
            color={onlyExpiring ? '#fff' : C.textSecondary}
            style={styles.chipIcon}
          />
          <RNText
            style={[
              styles.chipText,
              { color: onlyExpiring ? '#fff' : C.text },
              onlyExpiring && styles.chipTextActive,
            ]}
          >
            Expiră curând
          </RNText>
        </Pressable>

        {DOCUMENT_TYPES.map(({ value, label }) => {
          const isActive = filterType === value;
          return (
            <Pressable
              key={value}
              style={[
                styles.chip,
                { borderColor: C.border },
                isActive && { backgroundColor: '#9EB567', borderColor: '#9EB567' },
              ]}
              onPress={() => setFilterType(value)}
            >
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

      {/* ── Entity filter chips ── */}
      {entityOptions.length > 0 && (
        <RNView style={styles.chipsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsContent}
        >
          <Pressable
            style={[
              styles.chip,
              { borderColor: C.border },
              !filterEntity && { backgroundColor: '#9EB567', borderColor: '#9EB567' },
            ]}
            onPress={() => setFilterEntity(null)}
          >
            <RNText
              style={[
                styles.chipText,
                { color: !filterEntity ? '#fff' : C.text },
                !filterEntity && styles.chipTextActive,
              ]}
            >
              Toate
            </RNText>
          </Pressable>

          {entityOptions.slice(0, 8).map(opt => {
            const isActive = filterEntity?.id === opt.id;
            const entityIconName: IoniconName = ENTITY_ICON[opt.kind] ?? 'ellipse-outline';
            const truncated = opt.label.length > 18 ? opt.label.slice(0, 16) + '…' : opt.label;
            return (
              <Pressable
                key={`${opt.kind}-${opt.id}`}
                style={[
                  styles.chip,
                  { borderColor: C.border },
                  isActive && { backgroundColor: '#9EB567', borderColor: '#9EB567' },
                ]}
                onPress={() => setFilterEntity({ kind: opt.kind, id: opt.id })}
              >
                <Ionicons
                  name={entityIconName}
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
                  numberOfLines={1}
                >
                  {truncated}
                </RNText>
              </Pressable>
            );
          })}
        </ScrollView>
        </RNView>
      )}

      {/* ── Error banner ── */}
      {error ? (
        <RNView style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={16} color="#E53935" />
          <RNText style={styles.errorText}>{error}</RNText>
        </RNView>
      ) : null}

      {/* ── Document list ── */}
      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={[
          styles.listContent,
          filtered.length === 0 && styles.listContentEmpty,
        ]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />}
        ListEmptyComponent={
          !loading ? <EmptyState isFiltered={isFiltered} scheme={scheme} /> : null
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />

      {/* ── FAB ── */}
      <Pressable
        style={({ pressed }) => [
          styles.fab,
          pressed && styles.fabPressed,
        ]}
        onPress={() => router.push('/(tabs)/documente/add')}
        accessibilityLabel="Adaugă document"
        accessibilityRole="button"
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </RNView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerLeft: {
    gap: 2,
  },
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
    marginTop: 10,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    height: 48,
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
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    height: '100%',
  },

  // Filter chips row
  chipsRow: {
    height: 44,
    flexShrink: 0,
    overflow: 'hidden',
  },
  chipsContent: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    gap: 7,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 13,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipIcon: {
    marginRight: 4,
  },
  chipText: {
    fontSize: 13,
    lineHeight: 18,
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },

  // Error banner
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
  errorText: {
    color: '#E53935',
    fontSize: 13,
    flex: 1,
  },

  // List
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 96,
  },
  listContentEmpty: {
    flexGrow: 1,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#9EB567',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.22,
        shadowRadius: 6,
      },
      android: { elevation: 6 },
    }),
  },
  fabPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.96 }],
  },
});
