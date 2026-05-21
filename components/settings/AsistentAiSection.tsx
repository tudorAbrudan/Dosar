import { View, Text, Switch, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';
import * as aiProvider from '@/services/aiProvider';
import type { AiProviderType } from '@/services/aiProvider';
import { iconColors } from '@/theme/iconColors';
import { primary } from '@/theme/colors';

interface AsistentAiSectionProps {
  aiProviderType: AiProviderType;
  aiConsentGiven: boolean;
  aiMedicalAllowed: boolean;
  scheme: 'light' | 'dark';
  onOpenAiModal: () => void;
  onToggleAiMedical: (value: boolean) => void;
}

export function AsistentAiSection({
  aiProviderType,
  aiConsentGiven,
  aiMedicalAllowed,
  scheme,
  onOpenAiModal,
  onToggleAiMedical,
}: AsistentAiSectionProps) {
  const C = Colors[scheme];
  const providerLabel = aiProvider.PROVIDER_DEFAULTS[aiProviderType].label;
  const showConsentBadge =
    aiConsentGiven && (aiProviderType === 'builtin' || aiProviderType === 'external');

  return (
    <SectionCard title="Asistent AI" scheme={scheme}>
      <InfoRow
        icon="sparkles-outline"
        iconBg={iconColors.aiPurple.bg}
        iconColor={iconColors.aiPurple.fg}
        label="Provider AI"
        sub={providerLabel + (showConsentBadge ? ' · Acord acordat' : '')}
        onPress={onOpenAiModal}
        scheme={scheme}
      />
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <View style={[styles.rowIcon, { backgroundColor: iconColors.pink.bg }]}>
            <Ionicons
              name="medkit-outline"
              size={18}
              color={iconColors.pink.fg}
            />
          </View>
          <View style={styles.rowLabelWrap}>
            <Text style={[styles.rowLabel, { color: C.text }]}>Date medicale (Art. 9 GDPR)</Text>
            <Text style={[styles.rowSub, { color: C.textSecondary }]}>
              Permite asistentului AI să acceseze observațiile și documentele medicale. Datele se
              criptează local cu AES-256-GCM. Poți dezactiva oricând.
            </Text>
          </View>
        </View>
        <Switch
          value={aiMedicalAllowed}
          onValueChange={onToggleAiMedical}
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
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    marginTop: 2,
  },
  rowLabelWrap: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowSub: { fontSize: 12, marginTop: 1, lineHeight: 16 },
});
