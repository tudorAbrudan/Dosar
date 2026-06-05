import { memo } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import { statusColors, light, dark } from '@/theme/colors';
import type { LegalObligation } from '@/services/vehicleStatus';

function colorFor(status: LegalObligation['status']): string {
  if (status === 'ok') return statusColors.ok;
  if (status === 'expiring') return statusColors.warning;
  return statusColors.critical; // expired | missing
}

function textFor(o: LegalObligation): string {
  if (o.status === 'missing') return 'lipsește';
  if (o.status === 'expired') return 'expirat';
  if (o.status === 'expiring')
    return `expiră în ${o.daysRemaining} ${o.daysRemaining === 1 ? 'zi' : 'zile'}`;
  return 'valabil';
}

export const VehicleLegalStatus = memo(function VehicleLegalStatus({
  vehicleId,
  obligations,
}: {
  vehicleId: string;
  obligations: LegalObligation[];
}) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  if (obligations.length === 0) return null;
  const allOk = obligations.every(o => o.status === 'ok');

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: palette.textSecondary }]}>STATUS LEGAL</Text>
      {allOk ? (
        <View style={[styles.row, { backgroundColor: palette.card }]}>
          <Ionicons name="checkmark-circle" size={18} color={statusColors.ok} />
          <Text style={[styles.label, { color: palette.text }]}>Mașină în regulă</Text>
        </View>
      ) : (
        obligations
          .filter(o => o.status !== 'ok')
          .map(o => {
            const c = colorFor(o.status);
            const actionable = o.status === 'missing' || o.status === 'expired';
            return (
              <Pressable
                key={o.key}
                disabled={!actionable}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/documente/add',
                    params: { vehicle_id: vehicleId, type: o.key },
                  })
                }
                style={[styles.row, { backgroundColor: palette.card }]}
              >
                <View style={[styles.dot, { backgroundColor: c }]} />
                <Text style={[styles.label, { color: palette.text }]}>{o.label}</Text>
                <Text style={[styles.status, { color: c }]}>{textFor(o)}</Text>
                {actionable ? (
                  <Ionicons name="add-circle-outline" size={18} color={palette.textSecondary} />
                ) : null}
              </Pressable>
            );
          })
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, marginVertical: 8 },
  title: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 15, fontWeight: '600', flex: 1 },
  status: { fontSize: 14, fontWeight: '600' },
});
