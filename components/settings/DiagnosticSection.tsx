import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { onPrimary, statusColors } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { AppButton } from '@/components/ui/AppButton';
import type { NativeCrashReport } from '@/services/crashReporter';
import { SectionCard } from './SectionCard';
import { InfoRow } from './InfoRow';

interface DiagnosticSectionProps {
  crash: NativeCrashReport;
  scheme: 'light' | 'dark';
  onCopy: () => void;
  onClear: () => void;
}

/**
 * Secțiunea Diagnostic — afișată DOAR când există un crash report neters.
 * Conține informațiile crash-ului (versiune + timestamp + nume + reason)
 * și acțiuni: Copy details (în clipboard), Șterge raportul.
 */
export function DiagnosticSection({ crash, scheme, onCopy, onClear }: DiagnosticSectionProps) {
  const C = Colors[scheme];
  return (
    <SectionCard title="Diagnostic" scheme={scheme}>
      <InfoRow
        icon="bug-outline"
        iconBg={iconColors.danger.bg}
        iconColor={statusColors.critical}
        label="Ultimul crash"
        sub={`v${crash.appVersion} (build ${crash.buildNumber}) · ${new Date(
          crash.timestamp
        ).toLocaleString('ro-RO')}`}
        scheme={scheme}
      />
      <View style={styles.details}>
        <Text style={[styles.hint, { color: C.textSecondary }]}>
          {`${crash.name}${crash.reason ? `: ${crash.reason}` : ''}`}
        </Text>
        <AppButton
          title="Copiază detalii"
          onPress={onCopy}
          accessibilityLabel="Copiază detalii crash"
          icon={<Ionicons name="copy-outline" size={18} color={onPrimary} />}
        />
        <AppButton
          title="Șterge raportul"
          variant="danger"
          onPress={onClear}
          accessibilityLabel="Șterge raportul de crash"
          icon={<Ionicons name="trash-outline" size={18} color={statusColors.critical} />}
        />
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  details: { gap: 10, paddingTop: 12, paddingBottom: 12 },
  hint: { fontSize: 12, lineHeight: 18 },
});
