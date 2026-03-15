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
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { DOCUMENT_TYPE_LABELS, getDocumentLabel } from '@/types';
import type { Document, DocumentType } from '@/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const EXPIRING_DAYS = 30;
const RECENT_COUNT = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const DOC_ICON: Partial<Record<DocumentType, IoniconName>> = {
  buletin: 'id-card', pasaport: 'book', permis_auto: 'car',
  talon: 'document-text', carte_auto: 'document',
  rca: 'shield-checkmark', casco: 'shield-half', itp: 'checkmark-circle',
  vigneta: 'ribbon', act_proprietate: 'home', cadastru: 'map',
  factura: 'receipt', impozit_proprietate: 'cash-outline', card: 'card',
  garantie: 'ribbon-outline', reteta_medicala: 'medkit-outline',
  analize_medicale: 'flask-outline', bon_cumparaturi: 'receipt-outline',
  pad: 'home-outline', stingator_incendiu: 'flame-outline',
  abonament: 'repeat-outline', contract: 'document-text-outline',
  vaccin_animal: 'fitness-outline', deparazitare: 'bug-outline',
  vizita_vet: 'paw-outline', bilet: 'ticket-outline',
  altul: 'document-outline', custom: 'document-outline',
};

const DOC_ICON_BG: Partial<Record<DocumentType, string>> = {
  buletin: '#E3F2FD', pasaport: '#E8EAF6', permis_auto: '#FFF3E0',
  talon: '#E0F2F1', carte_auto: '#E0F2F1', rca: '#FCE4EC', casco: '#FCE4EC',
  itp: '#F3E5F5', vigneta: '#FFF8E1', act_proprietate: '#E8F5E9',
  cadastru: '#E8F5E9', factura: '#FFF3E0', impozit_proprietate: '#FFF8E1',
  card: '#F3E5F5', garantie: '#E8F5E9', reteta_medicala: '#FCE4EC',
  analize_medicale: '#E3F2FD', bon_cumparaturi: '#FFF8E1', pad: '#E3F2FD',
  stingator_incendiu: '#FCE4EC', abonament: '#F3E5F5', contract: '#E8EAF6',
  vaccin_animal: '#E8F5E9', deparazitare: '#FFF8E1', vizita_vet: '#E8EAF6',
  bilet: '#F3E5F5', altul: '#F5F5F5', custom: '#F5F5F5',
};

const DOC_ICON_COLOR: Partial<Record<DocumentType, string>> = {
  buletin: '#1565C0', pasaport: '#283593', permis_auto: '#E65100',
  talon: '#00695C', carte_auto: '#00897B', rca: '#C62828', casco: '#AD1457',
  itp: '#6A1B9A', vigneta: '#F57F17', act_proprietate: '#2E7D32',
  cadastru: '#388E3C', factura: '#BF360C', impozit_proprietate: '#F57F17',
  card: '#7B1FA2', garantie: '#2E7D32', reteta_medicala: '#C62828',
  analize_medicale: '#1565C0', bon_cumparaturi: '#F57F17', pad: '#1565C0',
  stingator_incendiu: '#BF360C', abonament: '#7B1FA2', contract: '#283593',
  vaccin_animal: '#388E3C', deparazitare: '#F57F17', vizita_vet: '#283593',
  bilet: '#7B1FA2', altul: '#757575', custom: '#757575',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bună dimineața';
  if (h < 18) return 'Bună ziua';
  return 'Bună seara';
}

function daysUntil(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function expiryBadge(doc: Document): { label: string; bg: string; fg: string } | null {
  if (!doc.expiry_date) return null;
  const days = daysUntil(doc.expiry_date);
  if (days < 0) return { label: 'Expirat', bg: '#E53935', fg: '#fff' };
  if (days <= 30) return { label: `${days}z`, bg: '#F57C00', fg: '#fff' };
  return null;
}

// ─── Alert generation ─────────────────────────────────────────────────────────

interface SmartAlert {
  id: string;
  message: string;
  icon: IoniconName;
  iconBg: string;
  iconColor: string;
  action?: () => void;
  actionLabel?: string;
}

function buildAlerts(
  documents: Document[],
  vehicles: { id: string; name: string }[],
  persons: { id: string; name: string }[]
): SmartAlert[] {
  const alerts: SmartAlert[] = [];

  // Verifică vehicule fără RCA
  for (const v of vehicles) {
    const hasRca = documents.some(d => d.vehicle_id === v.id && d.type === 'rca');
    if (!hasRca) {
      alerts.push({
        id: `no-rca-${v.id}`,
        message: `${v.name} nu are RCA`,
        icon: 'shield-outline',
        iconBg: '#FCE4EC',
        iconColor: '#C62828',
        action: () => router.push({ pathname: '/(tabs)/documente/add', params: { vehicle_id: v.id } }),
        actionLabel: 'Adaugă',
      });
    }
  }

  // Verifică vehicule fără ITP
  for (const v of vehicles) {
    const hasItp = documents.some(d => d.vehicle_id === v.id && d.type === 'itp');
    if (!hasItp) {
      alerts.push({
        id: `no-itp-${v.id}`,
        message: `${v.name} nu are ITP`,
        icon: 'checkmark-circle-outline',
        iconBg: '#F3E5F5',
        iconColor: '#6A1B9A',
        action: () => router.push({ pathname: '/(tabs)/documente/add', params: { vehicle_id: v.id } }),
        actionLabel: 'Adaugă',
      });
    }
  }

  // Verifică persoane fără buletin
  for (const p of persons) {
    const hasBuletin = documents.some(d => d.person_id === p.id && d.type === 'buletin');
    if (!hasBuletin) {
      alerts.push({
        id: `no-buletin-${p.id}`,
        message: `${p.name} nu are buletin`,
        icon: 'id-card-outline',
        iconBg: '#E3F2FD',
        iconColor: '#1565C0',
        action: () => router.push({ pathname: '/(tabs)/documente/add', params: { person_id: p.id } }),
        actionLabel: 'Adaugă',
      });
    }
  }

  return alerts.slice(0, 3); // max 3 alerte
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();

  const { documents, loading, refresh } = useDocuments();
  const { persons, properties, vehicles, cards, animals } = useEntities();
  const { customTypes } = useCustomTypes();

  useFocusEffect(useCallback(() => { refresh(); }, []));

  // ── Stats ────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const now = Date.now();
    const limit30 = now + EXPIRING_DAYS * 24 * 60 * 60 * 1000;
    let expired = 0, expiringSoon = 0;
    for (const d of documents) {
      if (!d.expiry_date) continue;
      const t = new Date(d.expiry_date).getTime();
      if (t < now) expired++;
      else if (t <= limit30) expiringSoon++;
    }
    return { total: documents.length, expired, expiringSoon };
  }, [documents]);

  // ── Expiring soon (30 days) ───────────────────────────────────────────────────
  const expiringSoon = useMemo(() => {
    const now = Date.now();
    const limit = now + EXPIRING_DAYS * 24 * 60 * 60 * 1000;
    return documents
      .filter(d => {
        if (!d.expiry_date) return false;
        const t = new Date(d.expiry_date).getTime();
        return t <= limit;
      })
      .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
      .slice(0, 5);
  }, [documents]);

  // ── Recent documents ─────────────────────────────────────────────────────────
  const recentDocs = useMemo(() =>
    [...documents]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, RECENT_COUNT),
    [documents]
  );

  // ── Smart alerts ─────────────────────────────────────────────────────────────
  const alerts = useMemo(
    () => buildAlerts(documents, vehicles, persons),
    [documents, vehicles, persons]
  );

  // ── Entity helpers ────────────────────────────────────────────────────────────
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

  const totalEntities = persons.length + properties.length + vehicles.length + cards.length + animals.length;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>

      {/* ── Header ── */}
      <RNView style={[styles.header, { backgroundColor: C.background, paddingTop: insets.top + 10 }]}>
        <RNView>
          <RNText style={[styles.greeting, { color: C.textSecondary }]}>{greeting()}</RNText>
          <RNText style={[styles.headerTitle, { color: C.text }]}>Acasă</RNText>
        </RNView>
        <Pressable
          style={[styles.addBtn, { backgroundColor: '#9EB567' }]}
          onPress={() => router.push('/(tabs)/documente/add')}
        >
          <Ionicons name="add" size={20} color="#fff" />
          <RNText style={styles.addBtnText}>Document</RNText>
        </Pressable>
      </RNView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Stats row ── */}
        <RNView style={styles.statsRow}>
          <Pressable
            style={[styles.statCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
            onPress={() => router.push('/(tabs)/documente')}
          >
            <RNText style={[styles.statNumber, { color: C.text }]}>{stats.total}</RNText>
            <RNText style={[styles.statLabel, { color: C.textSecondary }]}>Acte</RNText>
          </Pressable>

          <Pressable
            style={[styles.statCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
            onPress={() => router.push('/(tabs)/expirari')}
          >
            <RNText style={[styles.statNumber, { color: stats.expired > 0 ? '#E53935' : C.text }]}>
              {stats.expired}
            </RNText>
            <RNText style={[styles.statLabel, { color: C.textSecondary }]}>Expirate</RNText>
          </Pressable>

          <Pressable
            style={[styles.statCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
            onPress={() => router.push('/(tabs)/expirari')}
          >
            <RNText style={[styles.statNumber, { color: stats.expiringSoon > 0 ? '#F57C00' : C.text }]}>
              {stats.expiringSoon}
            </RNText>
            <RNText style={[styles.statLabel, { color: C.textSecondary }]}>Expiră{'\n'}în 30 zile</RNText>
          </Pressable>

          <Pressable
            style={[styles.statCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
            onPress={() => router.push('/(tabs)/entitati')}
          >
            <RNText style={[styles.statNumber, { color: C.text }]}>{totalEntities}</RNText>
            <RNText style={[styles.statLabel, { color: C.textSecondary }]}>Entități</RNText>
          </Pressable>
        </RNView>

        {/* ── Alerte contextuale ── */}
        {alerts.length > 0 && (
          <RNView style={styles.section}>
            <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>SUGESTII</RNText>
            {alerts.map(alert => (
              <RNView
                key={alert.id}
                style={[styles.alertCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
              >
                <RNView style={[styles.alertIcon, { backgroundColor: alert.iconBg }]}>
                  <Ionicons name={alert.icon} size={18} color={alert.iconColor} />
                </RNView>
                <RNText style={[styles.alertText, { color: C.text }]} numberOfLines={2}>
                  {alert.message}
                </RNText>
                {alert.action && (
                  <Pressable
                    style={[styles.alertBtn, { borderColor: '#9EB567' }]}
                    onPress={alert.action}
                  >
                    <RNText style={styles.alertBtnText}>{alert.actionLabel}</RNText>
                  </Pressable>
                )}
              </RNView>
            ))}
          </RNView>
        )}

        {/* ── Expiră curând ── */}
        {expiringSoon.length > 0 && (
          <RNView style={styles.section}>
            <RNView style={styles.sectionHeader}>
              <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
                EXPIRĂ ÎN {EXPIRING_DAYS} ZILE
              </RNText>
              <Pressable onPress={() => router.push('/(tabs)/expirari')}>
                <RNText style={styles.sectionLink}>Vezi toate</RNText>
              </Pressable>
            </RNView>
            {expiringSoon.map(doc => {
              const entityName = resolveEntityName(doc);
              const badge = expiryBadge(doc);
              return (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [
                    styles.docCard,
                    { backgroundColor: C.card, shadowColor: C.cardShadow },
                    pressed && styles.docCardPressed,
                  ]}
                  onPress={() => router.push(`/(tabs)/documente/${doc.id}`)}
                >
                  <RNView style={[styles.docIcon, { backgroundColor: DOC_ICON_BG[doc.type] ?? '#F5F5F5' }]}>
                    <Ionicons name={DOC_ICON[doc.type] ?? 'document-outline'} size={20} color={DOC_ICON_COLOR[doc.type] ?? '#757575'} />
                  </RNView>
                  <RNView style={styles.docContent}>
                    <RNText style={[styles.docTitle, { color: C.text }]} numberOfLines={1}>
                      {getDocumentLabel(doc, customTypes)}
                    </RNText>
                    {entityName && (
                      <RNText style={[styles.docSub, { color: C.textSecondary }]} numberOfLines={1}>
                        {entityName}
                      </RNText>
                    )}
                  </RNView>
                  {badge && (
                    <RNView style={[styles.badge, { backgroundColor: badge.bg }]}>
                      <RNText style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</RNText>
                    </RNView>
                  )}
                  <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
                </Pressable>
              );
            })}
          </RNView>
        )}

        {/* ── Adăugate recent ── */}
        {recentDocs.length > 0 && (
          <RNView style={styles.section}>
            <RNView style={styles.sectionHeader}>
              <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>ADĂUGATE RECENT</RNText>
              <Pressable onPress={() => router.push('/(tabs)/documente')}>
                <RNText style={styles.sectionLink}>Toate</RNText>
              </Pressable>
            </RNView>
            {recentDocs.map(doc => {
              const entityName = resolveEntityName(doc);
              const badge = expiryBadge(doc);
              return (
                <Pressable
                  key={doc.id}
                  style={({ pressed }) => [
                    styles.docCard,
                    { backgroundColor: C.card, shadowColor: C.cardShadow },
                    pressed && styles.docCardPressed,
                  ]}
                  onPress={() => router.push(`/(tabs)/documente/${doc.id}`)}
                >
                  <RNView style={[styles.docIcon, { backgroundColor: DOC_ICON_BG[doc.type] ?? '#F5F5F5' }]}>
                    <Ionicons name={DOC_ICON[doc.type] ?? 'document-outline'} size={20} color={DOC_ICON_COLOR[doc.type] ?? '#757575'} />
                  </RNView>
                  <RNView style={styles.docContent}>
                    <RNText style={[styles.docTitle, { color: C.text }]} numberOfLines={1}>
                      {getDocumentLabel(doc, customTypes)}
                    </RNText>
                    {entityName && (
                      <RNText style={[styles.docSub, { color: C.textSecondary }]} numberOfLines={1}>
                        {entityName}
                      </RNText>
                    )}
                  </RNView>
                  {badge && (
                    <RNView style={[styles.badge, { backgroundColor: badge.bg }]}>
                      <RNText style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</RNText>
                    </RNView>
                  )}
                  <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
                </Pressable>
              );
            })}
          </RNView>
        )}

        {/* ── Empty state ── */}
        {documents.length === 0 && !loading && (
          <RNView style={styles.emptyWrap}>
            <Ionicons name="documents-outline" size={72} color={C.textSecondary} style={styles.emptyIcon} />
            <RNText style={[styles.emptyTitle, { color: C.text }]}>Niciun document încă</RNText>
            <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
              Adaugă primul tău document apăsând butonul de mai jos.
            </RNText>
            <Pressable
              style={styles.emptyBtn}
              onPress={() => router.push('/(tabs)/documente/add')}
            >
              <RNText style={styles.emptyBtnText}>Adaugă document</RNText>
            </Pressable>
          </RNView>
        )}

        <RNView style={styles.bottomPad} />
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

  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  greeting: { fontSize: 13, lineHeight: 18, marginBottom: 1 },
  headerTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, lineHeight: 34 },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 100 },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  statNumber: { fontSize: 22, fontWeight: '700', lineHeight: 28 },
  statLabel: { fontSize: 11, textAlign: 'center', lineHeight: 14, marginTop: 2 },

  // Section
  section: { marginBottom: 20 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  sectionLink: { fontSize: 13, color: '#9EB567', fontWeight: '500' },

  // Alert cards
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 10,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  alertText: { flex: 1, fontSize: 14, lineHeight: 19 },
  alertBtn: {
    borderWidth: 1.5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexShrink: 0,
  },
  alertBtnText: { color: '#9EB567', fontSize: 13, fontWeight: '600' },

  // Doc cards
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 10,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  docCardPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  docIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  docContent: { flex: 1 },
  docTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  docSub: { fontSize: 12, lineHeight: 16, marginTop: 1 },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, flexShrink: 0 },
  badgeText: { fontSize: 11, fontWeight: '600' },

  // Empty state
  emptyWrap: { alignItems: 'center', marginTop: 40, paddingHorizontal: 32 },
  emptyIcon: { marginBottom: 16, opacity: 0.35 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  emptySub: { fontSize: 14, textAlign: 'center', lineHeight: 20, opacity: 0.8, marginBottom: 24 },
  emptyBtn: {
    backgroundColor: '#9EB567',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 28,
  },
  emptyBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  bottomPad: { height: 20 },

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
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.22, shadowRadius: 6 },
      android: { elevation: 6 },
    }),
  },
  fabPressed: { opacity: 0.88, transform: [{ scale: 0.96 }] },
});
