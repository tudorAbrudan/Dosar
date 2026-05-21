import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
import { AppButton } from '@/components/ui/AppButton';
import { SurfaceCard } from '@/components/ui/SurfaceCard';
import Colors from '@/constants/Colors';
import { primary, statusColors, onPrimary } from '@/theme/colors';
import { DOC_ICON_BG, DOC_ICON_COLOR } from '@/theme/docTypeColors';
import { DOC_ICON } from '@/theme/docTypeIcons';
import { iconColors } from '@/theme/iconColors';
import { radius, spacing } from '@/theme/layout';
import { useDocuments } from '@/hooks/useDocuments';
import { useEntities } from '@/hooks/useEntities';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useOrphans } from '@/hooks/useOrphans';
import { getShowOrphansOnHome } from '@/services/settings';
import { OrphansSection } from '@/components/OrphansSection';
import { getDocumentLabel } from '@/types';
import type { Document } from '@/types';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { findFileDuplicates, backfillFileHashes, deleteDocument } from '@/services/documents';
import { buildHomeAlerts } from '@/services/homeAlerts';
import { resolveDocumentEntityName } from '@/services/documentEntityName';
import { isStaleExpired } from '@/services/expiry';
import { useCloudRestoreDetector } from '@/hooks/useCloudRestoreDetector';
import { CloudBackupBanner } from '@/components/CloudBackupBanner';
import { findPersonsWithOrphanMedicalDocs } from '@/services/medicalRecord';
import { MigrateOrphansWizard } from '@/components/medical/MigrateOrphansWizard';

// ─── Constants ────────────────────────────────────────────────────────────────

const EXPIRING_DAYS = 30;
const RECENT_COUNT = 4;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  if (days < 0) return { label: 'Expirat', bg: statusColors.critical, fg: onPrimary };
  if (days <= 30) return { label: `${days}z`, bg: statusColors.warning, fg: onPrimary };
  return null;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const { documents, loading, refresh } = useDocuments();
  const {
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    refresh: refreshEntities,
  } = useEntities();
  const { customTypes } = useCustomTypes();
  const { visibleDocTypes } = useVisibilitySettings();
  const { groups: orphanGroups, refresh: refreshOrphans } = useOrphans();
  const [showOrphans, setShowOrphans] = useState(true);
  const [duplicateGroups, setDuplicateGroups] = useState<Document[][]>([]);
  const backfillDoneRef = useRef(false);
  const cloud = useCloudRestoreDetector();
  const [orphanMedicalCount, setOrphanMedicalCount] = useState(0);
  const [showMigrateWizard, setShowMigrateWizard] = useState(false);

  useEffect(() => {
    if (backfillDoneRef.current) return;
    backfillDoneRef.current = true;
    backfillFileHashes().catch(() => {});
  }, []);

  useEffect(() => {
    findPersonsWithOrphanMedicalDocs()
      .then(list => setOrphanMedicalCount(list.length))
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      refresh();
      refreshEntities();
      refreshOrphans();
      getShowOrphansOnHome()
        .then(setShowOrphans)
        .catch(() => {});
      findFileDuplicates()
        .then(setDuplicateGroups)
        .catch(() => {});
    }, [refreshOrphans])
  );

  // ── Stats ────────────────────────────────────────────────────────────────────
  // Expirate vechi (>30 zile) sunt excluse — rămân pe pagina entității și în RAG,
  // dar nu mai apar pe Home ca atenționare.
  const stats = useMemo(() => {
    const now = Date.now();
    const limit30 = now + EXPIRING_DAYS * 24 * 60 * 60 * 1000;
    let expired = 0,
      expiringSoon = 0;
    for (const d of documents) {
      if (!d.expiry_date) continue;
      if (isStaleExpired(d.expiry_date)) continue;
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
        if (isStaleExpired(d.expiry_date)) return false;
        const t = new Date(d.expiry_date).getTime();
        return t <= limit;
      })
      .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())
      .slice(0, 5);
  }, [documents]);

  // ── Recent documents ─────────────────────────────────────────────────────────
  const recentDocs = useMemo(
    () =>
      [...documents]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, RECENT_COUNT),
    [documents]
  );

  // ── Smart alerts ─────────────────────────────────────────────────────────────
  const alerts = useMemo(
    () => buildHomeAlerts(documents, vehicles, persons, visibleDocTypes),
    [documents, vehicles, persons, visibleDocTypes]
  );

  // ── Entity helpers ────────────────────────────────────────────────────────────
  const resolveEntityName = (doc: Document) =>
    resolveDocumentEntityName(doc, { persons, properties, vehicles, cards, animals, companies });

  const totalEntities =
    persons.length +
    properties.length +
    vehicles.length +
    cards.length +
    animals.length +
    companies.length;

  async function handleDeleteDuplicate(docId: string) {
    // Elimină imediat din UI (optimistic), apoi confirmă cu DB
    setDuplicateGroups(prev =>
      prev.map(g => g.filter(d => d.id !== docId)).filter(g => g.length >= 2)
    );
    await deleteDocument(docId);
    const updated = await findFileDuplicates();
    setDuplicateGroups(updated);
    void refresh();
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      {/* ── Header ── */}
      <RNView
        style={[styles.header, { backgroundColor: C.background, paddingTop: insets.top + 10 }]}
      >
        <RNView>
          <RNText style={[styles.greeting, { color: C.textSecondary }]}>{greeting()}</RNText>
        </RNView>
      </RNView>

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── Banner backup mai nou pe iCloud ── */}
        {cloud.showBanner && cloud.cloudMeta && (
          <CloudBackupBanner
            meta={cloud.cloudMeta}
            onRestore={() => router.push('/cloud-backup?action=restore')}
            onDismiss={cloud.dismiss}
          />
        )}

        {/* ── Banner migrare documente medicale orfane ── */}
        {orphanMedicalCount > 0 && (
          <Pressable
            onPress={() => setShowMigrateWizard(true)}
            style={[
              styles.medicalOrphanBanner,
              { backgroundColor: C.card, borderColor: C.primary },
            ]}
          >
            <Ionicons name="medkit-outline" size={18} color={C.primary} style={{ marginRight: 8 }} />
            <RNText style={[styles.medicalOrphanText, { color: C.text }]}>
              {'Ai '}
              <RNText style={{ fontWeight: '700' }}>{orphanMedicalCount}</RNText>
              {orphanMedicalCount === 1
                ? ' persoană cu documente medicale fără dosar dedicat. Atinge pentru a crea dosare.'
                : ' persoane cu documente medicale fără dosar dedicat. Atinge pentru a crea dosare.'}
            </RNText>
            <Ionicons name="chevron-forward" size={14} color={C.textSecondary} />
          </Pressable>
        )}

        {/* ── Rezumat + acțiuni (card integrat) ── */}
        <SurfaceCard style={styles.integratedCard}>
          <RNView style={styles.statsRow}>
            <Pressable style={styles.statCell} onPress={() => router.push('/(tabs)/documente')}>
              <RNText style={[styles.statNumber, { color: C.text }]}>{stats.total}</RNText>
              <RNText style={[styles.statLabel, { color: C.textSecondary }]}>Acte</RNText>
            </Pressable>
            <RNView style={[styles.statDivider, { backgroundColor: C.border }]} />
            <Pressable style={styles.statCell} onPress={() => router.push('/(tabs)/expirari')}>
              <RNText
                style={[
                  styles.statNumber,
                  { color: stats.expired > 0 ? statusColors.critical : C.text },
                ]}
              >
                {stats.expired}
              </RNText>
              <RNText style={[styles.statLabel, { color: C.textSecondary }]}>Expirate</RNText>
            </Pressable>
            <RNView style={[styles.statDivider, { backgroundColor: C.border }]} />
            <Pressable style={styles.statCell} onPress={() => router.push('/(tabs)/expirari')}>
              <RNText
                style={[
                  styles.statNumber,
                  { color: stats.expiringSoon > 0 ? statusColors.warning : C.text },
                ]}
              >
                {stats.expiringSoon}
              </RNText>
              <RNText style={[styles.statLabel, { color: C.textSecondary }]}>30 zile</RNText>
            </Pressable>
            <RNView style={[styles.statDivider, { backgroundColor: C.border }]} />
            <Pressable style={styles.statCell} onPress={() => router.push('/(tabs)/entitati')}>
              <RNText style={[styles.statNumber, { color: C.text }]}>{totalEntities}</RNText>
              <RNText style={[styles.statLabel, { color: C.textSecondary }]}>Entități</RNText>
            </Pressable>
          </RNView>
          <RNView style={[styles.actionsDivider, { backgroundColor: C.border }]} />
          <RNText style={[styles.actionsLabel, { color: C.textSecondary }]}>Adaugă rapid</RNText>
          <RNView style={styles.actionRow}>
            <AppButton
              title="Entitate"
              variant="outline"
              style={styles.actionBtn}
              icon={<Ionicons name="people-outline" size={18} color={C.primary} />}
              onPress={() => router.push('/(tabs)/entitati/add')}
            />
            <AppButton
              title="Document"
              variant="primary"
              style={styles.actionBtn}
              icon={<Ionicons name="document-text-outline" size={18} color="#fff" />}
              onPress={() => router.push('/(tabs)/documente/add')}
            />
          </RNView>
        </SurfaceCard>

        {/* ── De completat (orfani) ── */}
        {showOrphans && orphanGroups.length > 0 && <OrphansSection groups={orphanGroups} />}

        {/* ── Alerte contextuale ── */}
        {showOrphans && alerts.length > 0 && (
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
                <Pressable
                  style={[styles.alertBtn, { borderColor: C.primary }]}
                  onPress={() =>
                    router.push({ pathname: '/(tabs)/documente/add', params: alert.navigate })
                  }
                >
                  <RNText style={[styles.alertBtnText, { color: C.primary }]}>
                    {alert.actionLabel}
                  </RNText>
                </Pressable>
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
                  onPress={() => router.push(`/(tabs)/documente/${doc.id}?from=home`)}
                >
                  <RNView
                    style={[
                      styles.docIcon,
                      { backgroundColor: DOC_ICON_BG[doc.type] ?? iconColors.neutral.bg },
                    ]}
                  >
                    <Ionicons
                      name={DOC_ICON[doc.type] ?? 'document-outline'}
                      size={20}
                      color={DOC_ICON_COLOR[doc.type] ?? iconColors.neutral.fg}
                    />
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
              <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
                ADĂUGATE RECENT
              </RNText>
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
                  onPress={() => router.push(`/(tabs)/documente/${doc.id}?from=home`)}
                >
                  <RNView
                    style={[
                      styles.docIcon,
                      { backgroundColor: DOC_ICON_BG[doc.type] ?? iconColors.neutral.bg },
                    ]}
                  >
                    <Ionicons
                      name={DOC_ICON[doc.type] ?? 'document-outline'}
                      size={20}
                      color={DOC_ICON_COLOR[doc.type] ?? iconColors.neutral.fg}
                    />
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

        {/* ── Fișiere duplicate ── */}
        {duplicateGroups.length > 0 && (
          <RNView style={styles.section}>
            <RNView style={styles.sectionHeader}>
              <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
                FIȘIERE DUPLICATE
              </RNText>
              <RNView style={[styles.dupBadge, { backgroundColor: iconColors.warning.bg }]}>
                <RNText style={[styles.dupBadgeText, { color: iconColors.warning.fg }]}>
                  {duplicateGroups.length}
                </RNText>
              </RNView>
            </RNView>
            {duplicateGroups.map((group, gi) => (
              <RNView
                key={gi}
                style={[styles.dupCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
              >
                {group.map((doc, di) => (
                  <RNView
                    key={doc.id}
                    style={[
                      styles.dupRow,
                      di < group.length - 1 && {
                        borderBottomWidth: 1,
                        borderBottomColor: C.border,
                      },
                    ]}
                  >
                    <Pressable
                      style={styles.dupDocInfo}
                      onPress={() => router.push(`/(tabs)/documente/${doc.id}?from=home`)}
                    >
                      <RNView
                        style={[
                          styles.docIcon,
                          { backgroundColor: DOC_ICON_BG[doc.type] ?? iconColors.neutral.bg },
                        ]}
                      >
                        <Ionicons
                          name={DOC_ICON[doc.type] ?? 'document-outline'}
                          size={18}
                          color={DOC_ICON_COLOR[doc.type] ?? iconColors.neutral.fg}
                        />
                      </RNView>
                      <RNView style={styles.docContent}>
                        <RNText style={[styles.docTitle, { color: C.text }]} numberOfLines={1}>
                          {getDocumentLabel(doc, customTypes)}
                        </RNText>
                        <RNText
                          style={[styles.docSub, { color: C.textSecondary }]}
                          numberOfLines={1}
                        >
                          {doc.created_at.slice(0, 10)}
                          {(() => {
                            const en = resolveEntityName(doc);
                            return en ? ` · ${en}` : '';
                          })()}
                        </RNText>
                      </RNView>
                    </Pressable>
                    <Pressable
                      style={styles.dupDeleteBtn}
                      onPress={() => {
                        Alert.alert(
                          'Șterge document',
                          `Ștergi „${getDocumentLabel(doc, customTypes)}"?\nAcțiunea nu poate fi anulată.`,
                          [
                            { text: 'Anulează', style: 'cancel' },
                            {
                              text: 'Șterge',
                              style: 'destructive',
                              onPress: () => void handleDeleteDuplicate(doc.id),
                            },
                          ]
                        );
                      }}
                    >
                      <Ionicons name="trash-outline" size={16} color={statusColors.critical} />
                    </Pressable>
                  </RNView>
                ))}
              </RNView>
            ))}
          </RNView>
        )}

        {/* ── Empty state ── */}
        {documents.length === 0 && !loading && (
          <RNView style={styles.emptyWrap}>
            <Ionicons
              name="documents-outline"
              size={72}
              color={C.textSecondary}
              style={styles.emptyIcon}
            />
            <RNText style={[styles.emptyTitle, { color: C.text }]}>Niciun document încă</RNText>
            <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
              Adaugă primul tău document apăsând butonul de mai jos.
            </RNText>
            <AppButton
              title="Adaugă document"
              variant="primary"
              style={styles.emptyBtn}
              onPress={() => router.push('/(tabs)/documente/add')}
            />
          </RNView>
        )}

        <RNView style={styles.bottomPad} />
      </ScrollView>

      <MigrateOrphansWizard
        visible={showMigrateWizard}
        onClose={() => setShowMigrateWizard(false)}
        onDone={() => setOrphanMedicalCount(0)}
      />
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
    paddingHorizontal: spacing.screen,
    paddingBottom: 10,
  },
  greeting: { fontSize: 13, lineHeight: 18, marginBottom: 1 },
  headerTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, lineHeight: 34 },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 32 },

  integratedCard: {
    marginBottom: spacing.section,
    padding: spacing.cardPadding,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 72,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  statNumber: { fontSize: 20, fontWeight: '700', lineHeight: 26 },
  statLabel: { fontSize: 10, textAlign: 'center', lineHeight: 13, marginTop: 2 },
  actionsDivider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },
  actionsLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  actionRow: { flexDirection: 'row', gap: spacing.gap },
  actionBtn: { flex: 1, minWidth: 0, paddingVertical: 12, paddingHorizontal: 12, minHeight: 46 },

  section: { marginBottom: spacing.section },
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
  sectionLink: { fontSize: 13, color: primary, fontWeight: '500' },

  // Alert cards
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
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
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexShrink: 0,
  },
  alertBtnText: { fontSize: 13, fontWeight: '600' },

  // Doc cards
  docCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.lg,
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
  emptyBtn: { alignSelf: 'center', minWidth: 220, marginTop: 4 },

  bottomPad: { height: 20 },

  dupBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  dupBadgeText: { fontSize: 12, fontWeight: '700' },
  dupCard: {
    borderRadius: 12,
    marginBottom: 10,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  dupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dupDocInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  dupDeleteBtn: { padding: 8 },

  // Medical orphan banner
  medicalOrphanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  medicalOrphanText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
