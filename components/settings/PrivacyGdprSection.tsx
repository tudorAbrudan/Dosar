import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';

interface PrivacyGdprSectionProps {
  scheme: 'light' | 'dark';
  onShowPrivacy: () => void;
  onShowTerms: () => void;
  onDeleteAllData: () => void;
}

export function PrivacyGdprSection({
  scheme,
  onShowPrivacy,
  onShowTerms,
  onDeleteAllData,
}: PrivacyGdprSectionProps) {
  const C = Colors[scheme];
  return (
    <SectionCard title="Date și confidențialitate" scheme={scheme}>
      <InfoRow
        icon="shield-checkmark-outline"
        iconBg={iconColors.primary.bg}
        iconColor={primary}
        label="Politică de confidențialitate"
        sub="Cum sunt protejate datele tale · local pe dispozitiv"
        onPress={onShowPrivacy}
        scheme={scheme}
      />
      <InfoRow
        icon="document-text-outline"
        iconBg={iconColors.info.bg}
        iconColor={iconColors.info.fg}
        label="Termeni și condiții"
        onPress={onShowTerms}
        scheme={scheme}
      />
      <View style={styles.rowLast}>
        <View style={styles.rowLeft}>
          <View style={[styles.rowIcon, { backgroundColor: iconColors.pink.bg }]}>
            <Ionicons name="trash-outline" size={18} color={iconColors.pink.fg} />
          </View>
          <Text style={[styles.rowLabel, { color: statusColors.critical }]}>
            Șterge toate datele
          </Text>
        </View>
        <Pressable
          onPress={onDeleteAllData}
          hitSlop={8}
          accessibilityLabel="Șterge toate datele"
        >
          <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
        </Pressable>
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
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
});
