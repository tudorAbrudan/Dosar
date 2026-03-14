import { useCallback, useMemo } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  View as RNView,
  Text as RNText,
  Platform,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useDocuments } from '@/hooks/useDocuments';
import { useEntities } from '@/hooks/useEntities';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { Document, DocumentType } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const EXPIRING_DAYS = 7;

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

// ─── Expiry helpers ───────────────────────────────────────────────────────────

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
  return { label: `${daysLeft}z`, bg: '#9EB56722', fg: '#9EB567' };
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();

  const { documents, loading, refresh } = useDocuments();
  const { persons, properties, vehicles, cards, animals } = useEntities();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [])
  );

  // Filter documents expiring within EXPIRING_DAYS
  const expiring = useMemo(() => {
    const limit = Date.now() + EXPIRING_DAYS * 24 * 60 * 60 * 1000;
    return documents.filter(doc => {
      if (!doc.expiry_date) return false;
      const exp = new Date(doc.expiry_date).getTime();
      return exp <= limit;
    });
  }, [documents]);

  function resolveEntityName(doc: Document): string | null {
    if (doc.person_id) return persons.find(p => p.id === doc.person_id)?.name ?? null;
    if (doc.property_id) return properties.find(p => p.id === doc.property_id)?.name ?? null;
    if (doc.vehicle_id) return vehicles.find(v => v.id === doc.vehicle_id)?.name ?? null;
    if (doc.card_id) {
      const c = cards.find(c => c.id === doc.card_id);
      return c ? `${c.nickname ?? ''} ····${c.last4}`.trim() : null;
    }
    if (doc.animal_id) return animals.find(a => a.id === doc.animal_id)?.name ?? null;
    return null;
  }

  const expiredCount = expiring.filter(d => {
    if (!d.expiry_date) return false;
    return new Date(d.expiry_date).getTime() < Date.now();
  }).length;

  const subtitleText = expiring.length === 0
    ? 'Totul e în regulă'
    : expiredCount > 0
      ? `${expiredCount} expirate · ${expiring.length - expiredCount} viitoare`
      : `${expiring.length} expiră curând`;

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      {/* ── Custom Header ── */}
      <RNView style={[styles.header, { backgroundColor: C.background, paddingTop: insets.top + 8 }]}>
        <RNView style={styles.headerLeft}>
          <RNText style={[styles.headerTitle, { color: C.text }]}>Acasă</RNText>
          <RNText style={[styles.headerSub, { color: C.textSecondary }]}>{subtitleText}</RNText>
        </RNView>
      </RNView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── Expiring documents section ── */}
        <RNView style={styles.section}>
          <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
            EXPIRĂ ÎN URMĂTOARELE {EXPIRING_DAYS} ZILE
          </RNText>

          {expiring.length === 0 && !loading ? (
            <RNView style={styles.emptyWrap}>
              <Ionicons
                name="checkmark-circle-outline"
                size={64}
                color={C.textSecondary}
                style={styles.emptyIcon}
              />
              <RNText style={[styles.emptyTitle, { color: C.text }]}>
                Niciun document care expiră curând
              </RNText>
              <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
                Toate documentele tale sunt valabile.
              </RNText>
            </RNView>
          ) : (
            expiring.map(doc => {
              const entityName = resolveEntityName(doc);
              const iconBg = DOC_ICON_BG[doc.type] ?? '#F5F5F5';
              const iconColor = DOC_ICON_COLOR[doc.type] ?? '#757575';
              const iconName = DOC_ICON[doc.type] ?? 'document-outline';
              const expiry = getExpiryInfo(doc);
              return (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [
                    styles.card,
                    { backgroundColor: C.card, shadowColor: C.cardShadow },
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => router.push(`/(tabs)/documente/${doc.id}`)}
                  android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
                >
                  {/* Left icon */}
                  <RNView style={[styles.iconWrap, { backgroundColor: iconBg }]}>
                    <Ionicons name={iconName} size={22} color={iconColor} />
                  </RNView>

                  {/* Content */}
                  <RNView style={styles.cardContent}>
                    <RNText style={[styles.cardTitle, { color: C.text }]} numberOfLines={1}>
                      {DOCUMENT_TYPE_LABELS[doc.type]}
                    </RNText>
                    {entityName && (
                      <RNText
                        style={[styles.cardSub, { color: C.textSecondary }]}
                        numberOfLines={1}
                      >
                        {entityName}
                      </RNText>
                    )}
                  </RNView>

                  {/* Right: badge + chevron */}
                  <RNView style={styles.cardRight}>
                    {expiry && (
                      <RNView style={[styles.badge, { backgroundColor: expiry.bg }]}>
                        <RNText style={[styles.badgeText, { color: expiry.fg }]}>
                          {expiry.label}
                        </RNText>
                      </RNView>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
                  </RNView>
                </Pressable>
              );
            })
          )}
        </RNView>

        {/* ── Quick actions section ── */}
        <RNView style={styles.section}>
          <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
            ACȚIUNI RAPIDE
          </RNText>

          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => router.push('/(tabs)/documente/add')}
          >
            <Ionicons name="document-text-outline" size={20} color="#fff" style={styles.actionIcon} />
            <RNText style={styles.actionBtnText}>Adaugă document</RNText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionBtn,
              pressed && styles.actionBtnPressed,
            ]}
            onPress={() => router.push('/(tabs)/entitati/add')}
          >
            <Ionicons name="person-add-outline" size={20} color="#fff" style={styles.actionIcon} />
            <RNText style={styles.actionBtnText}>Adaugă entitate</RNText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionBtnOutline,
              { borderColor: C.primary },
              pressed && styles.actionBtnOutlinePressed,
            ]}
            onPress={() => router.push('/(tabs)/entitati/wizard-masina')}
          >
            <Ionicons name="car-outline" size={20} color={C.primary} style={styles.actionIcon} />
            <RNText style={[styles.actionBtnOutlineText, { color: C.primary }]}>
              Adaugă mașină (wizard)
            </RNText>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.actionBtnOutline,
              { borderColor: C.primary },
              pressed && styles.actionBtnOutlinePressed,
            ]}
            onPress={() => router.push('/(tabs)/entitati/wizard-proprietate')}
          >
            <Ionicons name="home-outline" size={20} color={C.primary} style={styles.actionIcon} />
            <RNText style={[styles.actionBtnOutlineText, { color: C.primary }]}>
              Adaugă proprietate (wizard)
            </RNText>
          </Pressable>
        </RNView>
      </ScrollView>

      {/* ── FAB ── */}
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
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

  // Scroll
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 96,
    gap: 24,
  },

  // Section
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: 4,
    paddingHorizontal: 2,
  },

  // Empty state
  emptyWrap: {
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 8,
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
    marginBottom: 0,
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
  cardRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
    gap: 4,
    flexShrink: 0,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },

  // Action buttons
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#9EB567',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  actionBtnPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  actionIcon: { marginRight: 10 },
  actionBtnText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  actionBtnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'transparent',
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  actionBtnOutlinePressed: { opacity: 0.7 },
  actionBtnOutlineText: { fontSize: 16, fontWeight: '500' },

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
