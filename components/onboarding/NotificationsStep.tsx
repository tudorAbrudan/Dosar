/**
 * Pasul NOTIFICATIONS din OnboardingWizard — toggle pentru remindere de
 * expirare + chip-uri „7/14/30 zile înainte". Banner cu „Deschide Setări"
 * când userul a respins permisiunea de notificări.
 */
import { Linking, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary, statusColors, onPrimary } from '@/theme/colors';
import { radius } from '@/theme/layout';

const NOTIF_DAY_OPTIONS = [7, 14, 30] as const;

export type NotifPermissionStatus = 'undetermined' | 'granted' | 'denied';

interface NotificationsStepProps {
  scheme: 'light' | 'dark';
  pushEnabled: boolean;
  notifDays: number;
  notifPermStatus: NotifPermissionStatus;
  onTogglePush: (value: boolean) => void;
  onChangeDays: (days: number) => void;
}

export function NotificationsStep({
  scheme,
  pushEnabled,
  notifDays,
  notifPermStatus,
  onTogglePush,
  onChangeDays,
}: NotificationsStepProps) {
  const C = Colors[scheme];

  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={[styles.label, { color: C.text }]}>Remindere expirări</Text>
          <Text style={[styles.sub, { color: C.textSecondary }]}>
            Notificări locale când se apropie data expirării
          </Text>
        </View>
        <Switch
          value={pushEnabled}
          onValueChange={onTogglePush}
          trackColor={{ false: C.border, true: primary }}
        />
      </View>
      {notifPermStatus === 'denied' && (
        <View style={styles.permDeniedRow}>
          <Text style={[styles.permDeniedText, { color: statusColors.warning }]}>
            Notificările sunt blocate. Activează-le din Setări sistem.
          </Text>
          <Pressable onPress={() => Linking.openSettings()}>
            <Text style={[styles.permDeniedLink, { color: C.primary }]}>Deschide Setări</Text>
          </Pressable>
        </View>
      )}
      {pushEnabled && notifPermStatus !== 'denied' && (
        <>
          <Text style={[styles.daysLabel, { color: C.textSecondary }]}>
            Câte zile înainte să te anunțăm
          </Text>
          <View style={styles.chipRow}>
            {NOTIF_DAY_OPTIONS.map(d => {
              const active = notifDays === d;
              return (
                <Pressable
                  key={d}
                  style={[
                    styles.chip,
                    active
                      ? [styles.chipActive, { borderColor: C.primary }]
                      : { borderColor: C.border, backgroundColor: C.background },
                  ]}
                  onPress={() => onChangeDays(d)}
                >
                  <Text
                    style={[styles.chipText, { color: active ? onPrimary : C.text }]}
                  >
                    {d} zile
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowText: { flex: 1 },
  label: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  permDeniedRow: { marginTop: 12, gap: 6 },
  permDeniedText: { fontSize: 13, lineHeight: 18 },
  permDeniedLink: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
  daysLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 16,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  chipActive: { backgroundColor: primary },
  chipText: { fontSize: 13, fontWeight: '500' },
});
