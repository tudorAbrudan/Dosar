import { useCallback } from 'react';
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
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { Document, DocumentType } from '@/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  impozit_proprietate: 'cash-outline',
  card: 'card',
  garantie: 'ribbon-outline',
  reteta_medicala: 'medkit-outline',
  analize_medicale: 'flask-outline',
  bon_cumparaturi: 'receipt-outline',
  pad: 'home-outline',
  stingator_incendiu: 'flame-outline',
  abonament: 'repeat-outline',
  contract: 'document-text-outline',
  vaccin_animal: 'fitness-outline',
  deparazitare: 'bug-outline',
  vizita_vet: 'paw-outline',
  bilet: 'ticket-outline',
  certificat_inregistrare: 'document-text-outline',
  autorizatie_activitate: 'shield-checkmark-outline',
  act_constitutiv: 'document-text-outline',
  certificat_tva: 'receipt-outline',
  asigurare_profesionala: 'shield-outline',
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
  impozit_proprietate: '#FFF8E1',
  card: '#F3E5F5',
  garantie: '#E8F5E9',
  reteta_medicala: '#FCE4EC',
  analize_medicale: '#E3F2FD',
  bon_cumparaturi: '#FFF8E1',
  pad: '#E3F2FD',
  stingator_incendiu: '#FCE4EC',
  abonament: '#F3E5F5',
  contract: '#E8EAF6',
  vaccin_animal: '#E8F5E9',
  deparazitare: '#FFF8E1',
  vizita_vet: '#E8EAF6',
  bilet: '#F3E5F5',
  certificat_inregistrare: '#E8EAF6',
  autorizatie_activitate: '#E8F5E9',
  act_constitutiv: '#E8EAF6',
  certificat_tva: '#FFF3E0',
  asigurare_profesionala: '#FCE4EC',
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
  impozit_proprietate: '#F57F17',
  card: '#7B1FA2',
  garantie: '#2E7D32',
  reteta_medicala: '#C62828',
  analize_medicale: '#1565C0',
  bon_cumparaturi: '#F57F17',
  pad: '#1565C0',
  stingator_incendiu: '#BF360C',
  abonament: '#7B1FA2',
  contract: '#283593',
  vaccin_animal: '#388E3C',
  deparazitare: '#F57F17',
  vizita_vet: '#283593',
  bilet: '#7B1FA2',
  certificat_inregistrare: '#283593',
  autorizatie_activitate: '#2E7D32',
  act_constitutiv: '#283593',
  certificat_tva: '#E65100',
  asigurare_profesionala: '#C62828',
  altul: '#757575',
  custom: '#757575',
};

const today = new Date().toISOString().slice(0, 10);

function isExpired(expiryDate: string): boolean {
  return expiryDate < today;
}

function getExpiryInfo(doc: Document): { label: string; bg: string; fg: string } | null {
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
  if (daysLeft <= 365) {
    return { label: `${daysLeft}z`, bg: '#9EB56722', fg: '#9EB567' };
  }
  // Pentru date departe: afișează luna și anul
  const date = new Date(doc.expiry_date);
  const label = date.toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' });
  return { label, bg: '#9EB56722', fg: '#9EB567' };
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ExpirariScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();

  const { documents, loading, refresh } = useDocuments();
  const { persons, properties, vehicles, cards, animals } = useEntities();
  const { visibleDocTypes } = useVisibilitySettings();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [])
  );

  const withExpiry = documents.filter(d => !!d.expiry_date && visibleDocTypes.includes(d.type));
  const expired = withExpiry.filter(d => d.expiry_date && isExpired(d.expiry_date));
  const upcoming = withExpiry.filter(d => d.expiry_date && !isExpired(d.expiry_date));

  const subtitleText =
    withExpiry.length === 0
      ? 'Niciun document cu dată de expirare'
      : `${expired.length > 0 ? `${expired.length} expirate · ` : ''}${upcoming.length} viitoare`;

  function resolveEntityName(doc: Document): string | null {
    if (doc.person_id) return persons.find(p => p.id === doc.person_id)?.name ?? null;
    if (doc.vehicle_id) return vehicles.find(v => v.id === doc.vehicle_id)?.name ?? null;
    if (doc.property_id) return properties.find(p => p.id === doc.property_id)?.name ?? null;
    if (doc.card_id) {
      const card = cards.find(c => c.id === doc.card_id);
      return card ? `${card.nickname ?? ''} ••${card.last4}`.trim() : null;
    }
    if (doc.animal_id) return animals.find(a => a.id === doc.animal_id)?.name ?? null;
    return null;
  }

  const renderCard = (doc: Document) => {
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
      <RNView style={[styles.header, { backgroundColor: C.background, paddingTop: insets.top + 8 }]}>
        <RNView style={styles.headerLeft}>
          <RNText style={[styles.headerTitle, { color: C.text }]}>Expirări</RNText>
          <RNText style={[styles.headerSub, { color: C.textSecondary }]}>{subtitleText}</RNText>
        </RNView>
      </RNView>

      <ScrollView
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
});
