import { TextInput, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { SectionCard } from './SectionCard';
import { InfoRow } from './InfoRow';

interface NotificariSectionProps {
  notifDays: number;
  pushEnabled: boolean;
  showOrphans: boolean;
  scheme: 'light' | 'dark';
  onNotifDaysChange: (value: string) => void;
  onPushToggle: (value: boolean) => void;
  onShowOrphansToggle: (value: boolean) => void;
}

/** Secțiunea Notificări — avertizări de expirare și sugestiile de pe Acasă. Pliabilă. */
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
    <SectionCard title="Notificări" scheme={scheme} collapsible>
      <InfoRow
        icon="time-outline"
        iconBg={iconColors.info.bg}
        iconColor={iconColors.info.fg}
        label="Zile înainte de expirare"
        right={
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
            accessibilityLabel="Zile înainte de expirare"
          />
        }
        scheme={scheme}
      />
      <InfoRow
        icon="notifications-outline"
        iconBg={iconColors.primary.bg}
        iconColor={primary}
        label="Notificări de expirare"
        switchValue={pushEnabled}
        onSwitchChange={onPushToggle}
        scheme={scheme}
      />
      <InfoRow
        icon="checkmark-done-outline"
        iconBg={iconColors.warning.bg}
        iconColor={iconColors.warning.fg}
        label="Sugestii pe Acasă"
        switchValue={showOrphans}
        onSwitchChange={onShowOrphansToggle}
        scheme={scheme}
      />
    </SectionCard>
  );
}

const styles = StyleSheet.create({
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
