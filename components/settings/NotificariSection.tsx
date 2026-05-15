import { View, Text, Switch, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { SectionCard } from './SectionCard';

interface NotificariSectionProps {
  notifDays: number;
  pushEnabled: boolean;
  showOrphans: boolean;
  scheme: 'light' | 'dark';
  onNotifDaysChange: (value: string) => void;
  onPushToggle: (value: boolean) => void;
  onShowOrphansToggle: (value: boolean) => void;
}

export function NotificariSection({
  notifDays,
  pushEnabled,
  showOrphans,
  scheme,
  onNotifDaysChange,
  onPushToggle,
  onShowOrphansToggle,
}: NotificariSectionProps) {
  const C = Colors[scheme];
  return (
    <SectionCard title="Notificări" scheme={scheme}>
      <View style={[styles.row, { borderBottomColor: C.border }]}>
        <View style={styles.rowLeft}>
          <View style={[styles.rowIcon, { backgroundColor: iconColors.info.bg }]}>
            <Ionicons name="time-outline" size={18} color={iconColors.info.fg} />
          </View>
          <Text style={[styles.rowLabel, { color: C.text }]}>Zile înainte de expirare</Text>
        </View>
        <TextInput
          style={[
            styles.inputSmall,
            { color: C.text, borderColor: C.border, backgroundColor: C.background },
          ]}
          value={String(notifDays)}
          onChangeText={onNotifDaysChange}
          keyboardType="number-pad"
          maxLength={2}
          placeholderTextColor={C.textSecondary}
        />
      </View>
      <View style={[styles.row, { borderBottomColor: C.border }]}>
        <View style={styles.rowLeft}>
          <View style={[styles.rowIcon, { backgroundColor: iconColors.primary.bg }]}>
            <Ionicons name="notifications-outline" size={18} color={primary} />
          </View>
          <Text style={[styles.rowLabel, { color: C.text }]}>Notificări push</Text>
        </View>
        <Switch
          value={pushEnabled}
          onValueChange={onPushToggle}
          trackColor={{ false: C.border, true: primary }}
          thumbColor="#fff"
        />
      </View>
      <View style={styles.rowLast}>
        <View style={styles.rowLeft}>
          <View style={[styles.rowIcon, { backgroundColor: iconColors.warning.bg }]}>
            <Ionicons name="checkmark-done-outline" size={18} color={iconColors.warning.fg} />
          </View>
          <Text style={[styles.rowLabel, { color: C.text }]}>Sugestii pe Acasă</Text>
        </View>
        <Switch
          value={showOrphans}
          onValueChange={onShowOrphansToggle}
          trackColor={{ false: C.border, true: primary }}
          thumbColor="#fff"
        />
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  inputSmall: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    width: 56,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
  },
});
