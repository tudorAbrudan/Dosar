import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';

interface AboutSectionProps {
  appName: string;
  appVersion: string;
  checkingUpdate: boolean;
  scheme: 'light' | 'dark';
  onCheckForUpdate: () => void;
}

export function AboutSection({
  appName,
  appVersion,
  checkingUpdate,
  scheme,
  onCheckForUpdate,
}: AboutSectionProps) {
  const C = Colors[scheme];
  return (
    <SectionCard title="Despre aplicație" scheme={scheme}>
      <View style={[styles.row, { borderBottomColor: C.border }]}>
        <View style={styles.rowLeft}>
          <View style={[styles.rowIcon, { backgroundColor: iconColors.primary.bg }]}>
            <Ionicons name="folder-outline" size={18} color={primary} />
          </View>
          <View style={styles.rowLabelWrap}>
            <Text style={[styles.rowLabel, { color: C.text }]}>{appName}</Text>
            <Text style={[styles.rowSub, { color: C.textSecondary }]}>
              Local-first · OCR on-device · fără cont · React Native
            </Text>
          </View>
        </View>
        <Text style={[styles.versionBadge, { color: C.textSecondary, borderColor: C.border }]}>
          v{appVersion}
        </Text>
      </View>
      <InfoRow
        icon="cloud-download-outline"
        iconBg={iconColors.info.bg}
        iconColor={iconColors.info.fg}
        label="Verifică actualizări"
        sub={checkingUpdate ? 'Se verifică...' : `Versiune curentă: ${appVersion}`}
        onPress={onCheckForUpdate}
        isLast
        scheme={scheme}
      />
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
  rowLabelWrap: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 1, lineHeight: 16 },
  versionBadge: {
    fontSize: 12,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
});
