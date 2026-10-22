import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { formatLastBackup } from '@/services/cloud/format';
import type { CloudStatus } from '@/types';
import { SectionCard } from './SectionCard';

interface BackupSectionProps {
  cloudStatus: CloudStatus;
  lastBackupAt: number | null;
  statusLoading: boolean;
  statusError: string | null;
  exporting: boolean;
  importing: boolean;
  repairing: boolean;
  scheme: 'light' | 'dark';
  onOpenCloudBackup: () => void;
  onExport: () => void;
  onImport: () => void;
  onRepairFiles: () => void;
}

interface StatusLine {
  text: string;
  /** null = fără punct (stare necunoscută). */
  dot: string | null;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

/**
 * Rândul iCloud e acțiunea principală a secțiunii, deci spune mereu starea:
 * cu același subtext pentru „pornit", „oprit" și „blocat", rândul se citea ca
 * titlul cardului, iar exportul ZIP (buton verde plin) părea backup-ul principal.
 */
function cloudStatusLine(
  status: CloudStatus,
  lastBackupAt: number | null,
  loading: boolean,
  error: string | null
): StatusLine {
  if (loading) return { text: 'Se verifică...', dot: null, icon: 'cloud-outline' };
  if (error) return { text: 'Starea nu a putut fi citită', dot: null, icon: 'cloud-outline' };
  switch (status) {
    case 'paused':
      return {
        text: 'Oprit · datele nu se salvează în iCloud',
        dot: statusColors.warning,
        icon: 'cloud-offline-outline',
      };
    case 'unavailable':
      return {
        text: 'Nu funcționează · iCloud nu e accesibil',
        dot: statusColors.critical,
        icon: 'cloud-offline-outline',
      };
    case 'needsPassword':
      return {
        text: 'Blocat · introdu parola de criptare',
        dot: statusColors.critical,
        icon: 'lock-closed-outline',
      };
    case 'noBackup':
      return {
        text: 'Activ · niciun backup încă',
        dot: statusColors.warning,
        icon: 'cloud-outline',
      };
    default:
      return {
        text: lastBackupAt
          ? `Activ · ultimul backup ${formatLastBackup(lastBackupAt)}`
          : 'Activ · niciun backup încă',
        dot: statusColors.ok,
        icon: 'cloud-done-outline',
      };
  }
}

export function BackupSection({
  cloudStatus,
  lastBackupAt,
  statusLoading,
  statusError,
  exporting,
  importing,
  repairing,
  scheme,
  onOpenCloudBackup,
  onExport,
  onImport,
  onRepairFiles,
}: BackupSectionProps) {
  const C = Colors[scheme];
  const line = cloudStatusLine(cloudStatus, lastBackupAt, statusLoading, statusError);
  return (
    <SectionCard title="Backup și restaurare" scheme={scheme}>
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        onPress={onOpenCloudBackup}
        accessibilityRole="button"
        accessibilityLabel={`iCloud Backup. ${line.text}`}
        accessibilityHint="Deschide setările backup-ului automat"
      >
        <View style={[styles.rowIcon, { backgroundColor: iconColors.primary.bg }]}>
          <Ionicons name={line.icon} size={18} color={iconColors.primary.fg} />
        </View>
        <View style={styles.rowLabelWrap}>
          <Text style={[styles.rowLabel, styles.primaryLabel, { color: C.text }]}>
            iCloud Backup
          </Text>
          {/* Punctul e glif în text: crește cu Dynamic Type și stă pe primul rând la wrap. */}
          <Text style={[styles.rowSub, styles.statusLine, { color: C.textSecondary }]}>
            {line.dot ? <Text style={{ color: line.dot }}>{'● '}</Text> : null}
            {line.text}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
      </Pressable>

      <View style={[styles.block, { borderTopColor: C.border }]}>
        <Text style={[styles.subLabel, { color: C.textSecondary }]}>
          Copie manuală (fișier ZIP)
        </Text>
        <Text style={[styles.hint, { color: C.textSecondary }]}>
          Un fișier cu datele și pozele, pe care îl păstrezi unde vrei (Files, calculator). Fișierul
          nu e criptat. Importul adaugă doar ce lipsește de pe telefon.
        </Text>
        <View style={styles.btnPair}>
          <Pressable
            style={({ pressed }) => [
              styles.btnOutline,
              { borderColor: primary, opacity: pressed || exporting ? 0.85 : 1 },
            ]}
            onPress={onExport}
            disabled={exporting}
            accessibilityRole="button"
            accessibilityLabel="Exportă backup ZIP"
            accessibilityState={{ busy: exporting, disabled: exporting }}
          >
            {exporting ? (
              <ActivityIndicator size="small" color={primary} style={styles.btnIcon} />
            ) : (
              <Ionicons
                name="cloud-upload-outline"
                size={18}
                color={primary}
                style={styles.btnIcon}
              />
            )}
            <Text style={[styles.btnOutlineText, { color: primary }]} numberOfLines={1}>
              Exportă
            </Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.btnOutline,
              { borderColor: primary, opacity: pressed || importing ? 0.85 : 1 },
            ]}
            onPress={onImport}
            disabled={importing}
            accessibilityRole="button"
            accessibilityLabel="Importă din fișier backup ZIP"
            accessibilityState={{ busy: importing, disabled: importing }}
          >
            {importing ? (
              <ActivityIndicator size="small" color={primary} style={styles.btnIcon} />
            ) : (
              <Ionicons
                name="cloud-download-outline"
                size={18}
                color={primary}
                style={styles.btnIcon}
              />
            )}
            <Text style={[styles.btnOutlineText, { color: primary }]} numberOfLines={1}>
              Importă
            </Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.row,
          styles.rowDivider,
          { borderTopColor: C.border },
          pressed && styles.pressed,
        ]}
        onPress={onRepairFiles}
        disabled={repairing}
        accessibilityRole="button"
        accessibilityLabel="Repară fișierele documentelor"
        accessibilityHint="Pentru poze care nu se mai afișează după o reinstalare sau o restaurare. Caută fișierele pe telefon și corectează legăturile."
        accessibilityState={{ busy: repairing, disabled: repairing }}
      >
        <View style={[styles.rowIcon, { backgroundColor: iconColors.neutral.bg }]}>
          <Ionicons name="build-outline" size={18} color={iconColors.neutral.fg} />
        </View>
        <View style={styles.rowLabelWrap}>
          <Text style={[styles.rowLabel, { color: C.text }]}>Repară fișierele documentelor</Text>
          <Text style={[styles.rowSub, { color: C.textSecondary }]}>
            {repairing ? 'Se verifică...' : 'Pentru poze care nu se mai afișează. Nu șterge nimic.'}
          </Text>
        </View>
        {repairing ? (
          <ActivityIndicator size="small" color={C.textSecondary} />
        ) : (
          <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
        )}
      </Pressable>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: 0.7 },
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
  primaryLabel: { fontSize: 16, fontWeight: '600' },
  rowSub: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  statusLine: { marginTop: 2 },
  block: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    paddingBottom: 14,
  },
  subLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 4, marginBottom: 12 },
  btnPair: { flexDirection: 'row', gap: 10 },
  btnIcon: { marginRight: 8 },
  btnOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  btnOutlineText: { fontSize: 15, fontWeight: '600' },
});
