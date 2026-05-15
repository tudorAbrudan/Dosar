import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { SectionCard } from './SectionCard';
import type { NativeCrashReport } from '@/services/crashReporter';

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
      <View style={[styles.row, { borderBottomColor: C.border }]}>
        <View style={styles.rowLeft}>
          <View style={[styles.rowIcon, { backgroundColor: iconColors.danger.bg }]}>
            <Ionicons name="bug-outline" size={18} color={statusColors.critical} />
          </View>
          <View style={styles.rowLabelWrap}>
            <Text style={[styles.rowLabel, { color: C.text }]}>Ultimul crash</Text>
            <Text style={[styles.rowSub, { color: C.textSecondary }]}>
              {`v${crash.appVersion} (build ${crash.buildNumber}) · ${new Date(
                crash.timestamp
              ).toLocaleString('ro-RO')}`}
            </Text>
          </View>
        </View>
      </View>
      <Text style={[styles.hint, { color: C.textSecondary }]}>
        {`${crash.name}${crash.reason ? `: ${crash.reason}` : ''}`}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.85 : 1 }]}
        onPress={onCopy}
        accessibilityLabel="Copiază detalii crash"
      >
        <Ionicons name="copy-outline" size={18} color="#fff" style={styles.btnIcon} />
        <Text style={styles.btnText}>Copiază detalii</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.btnOutline,
          { borderColor: statusColors.critical, opacity: pressed ? 0.85 : 1 },
        ]}
        onPress={onClear}
        accessibilityLabel="Șterge raportul de crash"
      >
        <Ionicons
          name="trash-outline"
          size={18}
          color={statusColors.critical}
          style={styles.btnIcon}
        />
        <Text style={[styles.btnOutlineText, { color: statusColors.critical }]}>
          Șterge raportul
        </Text>
      </Pressable>
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
  hint: { fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 12 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 10,
  },
  btnIcon: { marginRight: 8 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 13,
    marginBottom: 6,
  },
  btnOutlineText: { fontSize: 15, fontWeight: '600' },
});
