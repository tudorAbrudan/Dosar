import { useCallback, useRef, useState } from 'react';
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
import { primary, primaryTint, statusColors, onPrimary } from '@/theme/colors';
import { DOC_ICON_BG, DOC_ICON_COLOR } from '@/theme/docTypeColors';
import { DOC_ICON } from '@/theme/docTypeIcons';
import { iconColors } from '@/theme/iconColors';
import { useDocuments } from '@/hooks/useDocuments';
import { useEntities } from '@/hooks/useEntities';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { isExpired, isStaleExpired } from '@/services/expiry';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import { resolveDocumentEntityName } from '@/services/documentEntityName';
import type { Document } from '@/types';

function sortByExpiryAsc(a: Document, b: Document): number {
  return (a.expiry_date ?? '').localeCompare(b.expiry_date ?? '');
}

function getExpiryBorderColor(doc: Document): string {
  if (!doc.expiry_date) return 'transparent';
  const exp = new Date(doc.expiry_date).getTime();
  const now = Date.now();
  const daysLeft = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));
  if (daysLeft < 0) return statusColors.critical;
  if (daysLeft <= 30) return statusColors.warning;
  return primary;
}

function getExpiryInfo(doc: Document): { label: string; bg: string; fg: string } | null {
  if (!doc.expiry_date) return null;
  const exp = new Date(doc.expiry_date).getTime();
  const now = Date.now();
  const daysLeft = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));

  if (daysLeft < 0) {
    return { label: 'Expirat', bg: statusColors.critical, fg: onPrimary };
  }
  if (daysLeft <= 30) {
    return { label: `${daysLeft}z`, bg: statusColors.warning, fg: onPrimary };
  }
  const date = new Date(doc.expiry_date);
  const label = date.toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' });
  return { label, bg: primaryTint, fg: primary };
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ExpirariScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  const { documents, loading, refresh } = useDocuments();
  const { persons, properties, vehicles, cards, animals, companies } = useEntities();
  const { visibleDocTypes } = useVisibilitySettings();
  const [showStale, setShowStale] = useState(false);

  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      refresh();
    }, [])
  );

  const withExpiry = documents.filter(d => !!d.expiry_date && visibleDocTypes.includes(d.type));
  const expired = withExpiry
    .filter(d => d.expiry_date && isExpired(d.expiry_date) && !isStaleExpired(d.expiry_date))
    .sort(sortByExpiryAsc);
  const upcoming = withExpiry
    .filter(d => d.expiry_date && !isExpired(d.expiry_date))
    .sort(sortByExpiryAsc);
  // Expirate de mult (>30 zile de la expirare): ascunse by default ca să nu aglomereze
  // lista de atenție, dar accesibile printr-un toggle la bază.
  const staleExpired = withExpiry
    .filter(d => d.expiry_date && isStaleExpired(d.expiry_date))
    .sort(sortByExpiryAsc);

  const subtitleText =
    withExpiry.length === 0
      ? 'Niciun document cu dată de expirare'
      : `${expired.length > 0 ? `${expired.length} expirate · ` : ''}${upcoming.length} viitoare`;

  const resolveEntityName = (doc: Document) =>
    resolveDocumentEntityName(doc, { persons, properties, vehicles, cards, animals, companies });

  const renderCard = (doc: Document) => {
    const entityName = resolveEntityName(doc);
    const iconBg = DOC_ICON_BG[doc.type] ?? iconColors.neutral.bg;
    const iconColor = DOC_ICON_COLOR[doc.type] ?? iconColors.neutral.fg;
    const iconName = DOC_ICON[doc.type] ?? 'document-outline';
    const expiry = getExpiryInfo(doc);
    const borderColor = getExpiryBorderColor(doc);

    return (
      <Pressable
        key={doc.id}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: C.card, shadowColor: C.cardShadow, borderLeftColor: borderColor },
          pressed && styles.cardPressed,
        ]}
        onPress={() => router.push(`/(tabs)/documente/${doc.id}`)}
        android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
      >
        {/* Left: type icon */}
        <RNView style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <Ionicons name={iconName} size={22} color={iconColor} />
        </RNView>

        {/* Middle: text */}
        <RNView style={styles.cardContent}>
          <RNText style={[styles.cardTitle, { color: C.text }]} numberOfLines={1}>
            {DOCUMENT_TYPE_LABELS[doc.type]}
          </RNText>
          {entityName && (
            <RNText style={[styles.cardSub, { color: C.textSecondary }]} numberOfLines={1}>
              {entityName}
            </RNText>
          )}
        </RNView>

        {/* Right: badge + chevron */}
        <RNView style={styles.cardRight}>
          {expiry && (
            <RNView style={[styles.badge, { backgroundColor: expiry.bg }]}>
              <RNText style={[styles.badgeText, { color: expiry.fg }]}>{expiry.label}</RNText>
            </RNView>
          )}
          <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
        </RNView>
      </Pressable>
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

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          withExpiry.length === 0 && styles.scrollContentEmpty,
        ]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── Empty state ── */}
        {withExpiry.length === 0 && !loading && (
          <RNView style={styles.emptyWrap}>
            <Ionicons
              name="time-outline"
              size={64}
              color={C.textSecondary}
              style={styles.emptyIcon}
            />
            <RNText style={[styles.emptyTitle, { color: C.text }]}>
              Niciun document cu expirare
            </RNText>
            <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
              Documentele cu dată de expirare vor apărea aici.
            </RNText>
          </RNView>
        )}

        {/* ── Expirate section ── */}
        {expired.length > 0 && (
          <RNView style={styles.section}>
            <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>EXPIRATE</RNText>
            {expired.map(renderCard)}
          </RNView>
        )}

        {/* ── Viitoare section ── */}
        {upcoming.length > 0 && (
          <RNView style={styles.section}>
            <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
              {expired.length > 0 ? 'VIITOARE' : 'TOATE CU DATĂ DE EXPIRARE'}
            </RNText>
            {upcoming.map(renderCard)}
          </RNView>
        )}

        {/* ── Expirate de mult (>30 zile) — collapsible ── */}
        {staleExpired.length > 0 && (
          <RNView style={styles.section}>
            <Pressable
              style={({ pressed }) => [
                styles.staleToggle,
                { backgroundColor: C.card, shadowColor: C.cardShadow },
                pressed && styles.cardPressed,
              ]}
              onPress={() => setShowStale(v => !v)}
              android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
            >
              <Ionicons
                name="archive-outline"
                size={18}
                color={C.textSecondary}
                style={styles.staleIcon}
              />
              <RNView style={styles.staleTextWrap}>
                <RNText style={[styles.staleTitle, { color: C.text }]}>
                  Expirate de peste 30 zile
                </RNText>
                <RNText style={[styles.staleSub, { color: C.textSecondary }]}>
                  {staleExpired.length} {staleExpired.length === 1 ? 'document' : 'documente'} ·
                  arhivate din lista de atenție
                </RNText>
              </RNView>
              <Ionicons
                name={showStale ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={C.textSecondary}
              />
            </Pressable>
            {showStale && <RNView style={styles.staleList}>{staleExpired.map(renderCard)}</RNView>}
          </RNView>
        )}
      </ScrollView>
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
    paddingBottom: 40,
    gap: 20,
  },
  scrollContentEmpty: { flexGrow: 1 },

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
    borderLeftWidth: 4,
    padding: 14,
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

  // Stale expired toggle
  staleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
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
  staleIcon: { marginRight: 12 },
  staleTextWrap: { flex: 1, gap: 2 },
  staleTitle: { fontSize: 14, fontWeight: '600' },
  staleSub: { fontSize: 12 },
  staleList: { gap: 8, marginTop: 8 },
});
