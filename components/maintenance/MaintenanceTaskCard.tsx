/**
 * Card pentru un task de mentenanță în secțiunea „MENTENANȚĂ" de pe ecranul
 * vehiculului — icon din preset + nume + mesaj scadență (colorat după status)
 * + meta interval.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { statusColors } from '@/theme/colors';
import { getPreset } from '@/services/maintenancePresets';
import type { VehicleMaintenanceTask } from '@/types';

function statusColor(s: 'ok' | 'warning' | 'critical'): string {
  if (s === 'critical') return statusColors.critical;
  if (s === 'warning') return statusColors.warning;
  return statusColors.ok;
}

interface MaintenanceTaskCardProps {
  task: VehicleMaintenanceTask;
  status: { status: 'ok' | 'warning' | 'critical'; dueMessage: string };
  scheme: 'light' | 'dark';
  onPress: () => void;
}

export function MaintenanceTaskCard({ task, status, scheme, onPress }: MaintenanceTaskCardProps) {
  const C = Colors[scheme];
  const preset = getPreset(task.preset_key);
  const iconName = (preset?.icon ?? 'construct-outline') as keyof typeof Ionicons.glyphMap;
  const color = statusColor(status.status);

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        { backgroundColor: C.card, borderColor: C.border, borderLeftColor: color },
      ]}
    >
      <View style={[styles.icon, { backgroundColor: `${color}22` }]}>
        <Ionicons name={iconName} size={20} color={color} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, { color: C.text }]} numberOfLines={1}>
          {task.name}
        </Text>
        <Text style={[styles.due, { color }]} numberOfLines={1}>
          {status.dueMessage}
        </Text>
        <Text style={[styles.meta, { color: C.textSecondary }]} numberOfLines={1}>
          Interval:{' '}
          {task.trigger_km != null ? `${task.trigger_km.toLocaleString('ro-RO')} km` : '—'}
          {task.trigger_km != null && task.trigger_months != null ? ' / ' : ''}
          {task.trigger_months != null
            ? `${task.trigger_months} luni`
            : task.trigger_km == null
              ? '—'
              : ''}
        </Text>
      </View>
      <Ionicons name="ellipsis-horizontal" size={18} color={C.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderLeftWidth: 4,
    marginBottom: 8,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  due: { fontSize: 13, fontWeight: '500' },
  meta: { fontSize: 11 },
});
