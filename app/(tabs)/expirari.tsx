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
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { statusColors } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { useReminders } from '@/hooks/useReminders';
import { ReminderCard } from '@/components/reminders/ReminderCard';
import type { Reminder } from '@/types';

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ExpirariScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();

  const { reminders, loading, error, refresh } = useReminders();
  const [showStale, setShowStale] = useState(false);

  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      refresh();
    }, [])
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000).toISOString().split('T')[0];

  // Expirate recent (în ultimele 30 de zile)
  const expirate = reminders
    .filter(r => r.reminder_date < todayIso && r.reminder_date >= thirtyDaysAgo)
    .sort((a, b) => a.reminder_date.localeCompare(b.reminder_date));

  // Viitoare (de azi în colo)
  const viitoare = reminders
    .filter(r => r.reminder_date >= todayIso)
    .sort((a, b) => a.reminder_date.localeCompare(b.reminder_date));

  // Expirate de mult (>30 zile de la expirare): ascunse by default
  const expirateDeMult = reminders
    .filter(r => r.reminder_date < thirtyDaysAgo)
    .sort((a, b) => a.reminder_date.localeCompare(b.reminder_date));

  const total = reminders.length;

  const subtitleText =
    total === 0
      ? 'Nimic nu urmează'
      : `${expirate.length > 0 ? `${expirate.length} expirate · ` : ''}${viitoare.length} viitoare`;

  const handlePress = (r: Reminder) => {
    if (r.document_id) {
      router.push(`/(tabs)/documente/${r.document_id}?from=expirari`);
    }
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

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          total === 0 && styles.scrollContentEmpty,
        ]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* ── Empty state ── */}
        {total === 0 && !loading && (
          <RNView style={styles.emptyWrap}>
            <Ionicons
              name="time-outline"
              size={64}
              color={C.textSecondary}
              style={styles.emptyIcon}
            />
            <RNText style={[styles.emptyTitle, { color: C.text }]}>
              Nimic nu urmează
            </RNText>
            <RNText style={[styles.emptySub, { color: C.textSecondary }]}>
              Remindere și date de expirare vor apărea aici.
            </RNText>
          </RNView>
        )}

        {/* ── Expirate section ── */}
        {expirate.length > 0 && (
          <RNView style={styles.section}>
            <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>EXPIRATE</RNText>
            {expirate.map(r => (
              <ReminderCard key={r.id} reminder={r} onPress={handlePress} />
            ))}
          </RNView>
        )}

        {/* ── Viitoare section ── */}
        {viitoare.length > 0 && (
          <RNView style={styles.section}>
            <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>
              {expirate.length > 0 ? 'VIITOARE' : 'TOATE CU DATĂ DE EXPIRARE'}
            </RNText>
            {viitoare.map(r => (
              <ReminderCard key={r.id} reminder={r} onPress={handlePress} />
            ))}
          </RNView>
        )}

        {/* ── Expirate de mult (>30 zile) — collapsible ── */}
        {expirateDeMult.length > 0 && (
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
                  {expirateDeMult.length}{' '}
                  {expirateDeMult.length === 1 ? 'reminder' : 'remindere'} · arhivate din lista de
                  atenție
                </RNText>
              </RNView>
              <Ionicons
                name={showStale ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={C.textSecondary}
              />
            </Pressable>
            {showStale && (
              <RNView style={styles.staleList}>
                {expirateDeMult.map(r => (
                  <ReminderCard key={r.id} reminder={r} onPress={handlePress} />
                ))}
              </RNView>
            )}
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

  // Card pressed (used by staleToggle)
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },

  // Stale expired toggle
  staleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    ...Platform.select({
      ios: {
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

  // Error banner
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
});
