import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { formatLastBackup } from '@/services/cloud/format';
import type { CloudStatus } from '@/types';
import { AppButton } from '@/components/ui/AppButton';
import { SectionCard } from './SectionCard';
import { InfoRow } from './InfoRow';

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
  const [zipOpen, setZipOpen] = useState(false);
  const zipBusy = exporting || importing;
  return (
    <SectionCard title="Backup și restaurare" scheme={scheme}>
      {/* Plăcuța colorată + săgeata verde spun „apasă aici": ca rând simplu, iCloud Backup se
          citea ca antetul blocului ZIP de sub el, nu ca un buton. */}
      <Pressable
        style={({ pressed }) => [
          styles.cloudTile,
          { backgroundColor: C.primaryTint },
          pressed && styles.pressed,
        ]}
        onPress={onOpenCloudBackup}
        accessibilityRole="button"
        accessibilityLabel={`iCloud Backup. ${line.text}`}
        accessibilityHint="Deschide setările backup-ului automat"
      >
        <View style={[styles.rowIcon, { backgroundColor: iconColors.primary.bg }]}>
          <Ionicons name={line.icon} size={18} color={iconColors.primary.fg} />
        </View>
        <View style={styles.rowLabelWrap}>
          <Text style={[styles.rowLabel, { color: C.text }]}>iCloud Backup</Text>
          {/* Punctul e glif în text: crește cu Dynamic Type și stă pe primul rând la wrap. */}
          <Text style={[styles.rowSub, styles.statusLine, { color: C.textSecondary }]}>
            {line.dot ? <Text style={{ color: line.dot }}>{'● '}</Text> : null}
            {line.text}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={primary} />
      </Pressable>

      {/* Exportul/importul ZIP e o unealtă ocazională: stă închis, ca să nu concureze cu iCloud.
          Rândul și panoul sunt un singur copil al cardului, ca linia să nu cadă între ele. */}
      <View>
        <InfoRow
          icon="archive-outline"
          iconBg={iconColors.neutral.bg}
          iconColor={iconColors.neutral.fg}
          label="Copie manuală (fișier ZIP)"
          sub={
            exporting
              ? 'Se exportă...'
              : importing
                ? 'Se importă...'
                : 'Exportă sau importă un fișier backup'
          }
          onPress={() => setZipOpen(v => !v)}
          expanded={zipOpen}
          busy={zipBusy && !zipOpen}
          accessibilityHint={
            zipOpen ? 'Ascunde exportul și importul' : 'Arată exportul și importul'
          }
          scheme={scheme}
        />
        {zipOpen && (
          <View style={styles.zipPanel}>
            <Text style={[styles.hint, { color: C.textSecondary }]}>
              Un fișier cu datele și pozele, pe care îl păstrezi unde vrei (Files, calculator).
              Fișierul nu e criptat. Importul adaugă doar ce lipsește de pe telefon.
            </Text>
            <View style={styles.btnPair}>
              <AppButton
                title="Exportă"
                variant="outline"
                onPress={onExport}
                loading={exporting}
                accessibilityLabel="Exportă backup ZIP"
                icon={<Ionicons name="cloud-upload-outline" size={18} color={primary} />}
                style={styles.btn}
              />
              <AppButton
                title="Importă"
                variant="outline"
                onPress={onImport}
                loading={importing}
                accessibilityLabel="Importă din fișier backup ZIP"
                icon={<Ionicons name="cloud-download-outline" size={18} color={primary} />}
                style={styles.btn}
              />
            </View>
          </View>
        )}
      </View>

      <InfoRow
        icon="build-outline"
        iconBg={iconColors.neutral.bg}
        iconColor={iconColors.neutral.fg}
        label="Repară fișierele documentelor"
        sub={repairing ? 'Se verifică...' : 'Pentru poze care nu se mai afișează. Nu șterge nimic.'}
        onPress={onRepairFiles}
        busy={repairing}
        accessibilityHint="Pentru poze care nu se mai afișează după o reinstalare sau o restaurare. Caută fișierele pe telefon și corectează legăturile."
        scheme={scheme}
      />
    </SectionCard>
  );
}

const styles = StyleSheet.create({
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
  rowLabel: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12, lineHeight: 16, flexShrink: 1 },
  statusLine: { marginTop: 2 },
  cloudTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    marginTop: 12,
    marginBottom: 12,
  },
  zipPanel: { paddingBottom: 16 },
  hint: { fontSize: 12, lineHeight: 18, marginBottom: 12 },
  btnPair: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, paddingHorizontal: 12 },
});
