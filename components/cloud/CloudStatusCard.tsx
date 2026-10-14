/**
 * Card de status în ecranul Cloud Backup — punct colorat + label status,
 * eroare (dacă există), stats (ultimul backup, documente, DB size, pending,
 * failed) și o bară de progres când backup-ul rulează.
 *
 * Extras din `app/cloud-backup.tsx` (~85 linii inline).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { formatBytes } from '@/services/cloud/format';
import type { CloudStatus } from '@/types';
import type { BackupProgress } from '@/services/cloudSync';

const STATUS_LABELS: Record<CloudStatus, string> = {
  idle: 'Sincronizat',
  uploading: 'Se sincronizează...',
  restoring: 'Se restaurează...',
  error: 'Eroare',
  paused: 'Dezactivat',
  unavailable: 'iCloud indisponibil',
  needsPassword: 'Parolă necesară',
  noBackup: 'Niciun backup încă',
};

function statusDotColor(status: CloudStatus): string {
  switch (status) {
    case 'idle':
      return statusColors.ok;
    case 'uploading':
    case 'restoring':
      return statusColors.warning;
    case 'error':
    case 'unavailable':
    case 'needsPassword':
      return statusColors.critical;
    case 'paused':
    default:
      return statusColors.warning;
  }
}

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'Niciodată';
  const d = new Date(ts);
  return d.toLocaleString('ro-RO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export interface CloudStatusCardData {
  status: CloudStatus;
  error: string | null;
  lastUploadedAt: number | null;
  documentCount: number;
  dbSizeBytes: number;
  pendingCount: number;
  pendingBytes: number;
  failedCount: number;
  backupProgress: BackupProgress | null;
}

interface CloudStatusCardProps {
  cloud: CloudStatusCardData;
  scheme: 'light' | 'dark';
  /** Deschide promptul de parolă când backup-ul criptat e blocat. */
  onUnlock: () => void;
}

export function CloudStatusCard({ cloud, scheme, onUnlock }: CloudStatusCardProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusDotColor(cloud.status) }]} />
        <Text style={[styles.statusLabel, { color: C.text }]}>{STATUS_LABELS[cloud.status]}</Text>
      </View>
      {cloud.error ? (
        <Text style={[styles.errorText, { color: statusColors.critical }]}>{cloud.error}</Text>
      ) : null}
      {/* „iCloud indisponibil" singur nu spune nimic: cauza reală e aproape
          mereu iCloud Drive oprit din iOS, iar backup-ul tace la nesfârșit.
          Pașii sunt exacți fiindcă iOS îi ascunde sub „Vezi tot". */}
      {cloud.status === 'unavailable' ? (
        <Text style={[styles.hintText, { color: C.textSecondary }]}>
          iOS nu ne dă acces la iCloud, deci nu se salvează nimic. Verifică pe telefon:{' '}
          <Text style={{ fontWeight: '600' }}>
            Setări → [numele tău] → iCloud → Vezi tot → iCloud Drive
          </Text>{' '}
          să fie pornit, iar în listă aplicația <Text style={{ fontWeight: '600' }}>Dosar</Text> să
          fie activată. Dacă tocmai le-ai pornit, revino aici — starea se reîmprospătează singură.
        </Text>
      ) : null}
      {/* Cheia de criptare trăiește doar în memorie: după fiecare repornire a
          aplicației backup-ul se oprește până la parolă. Fără mesajul ăsta ecranul
          arăta „Se sincronizează..." la nesfârșit. */}
      {cloud.status === 'needsPassword' ? (
        <>
          <Text style={[styles.hintText, { color: C.textSecondary }]}>
            Backup-ul e criptat, iar parola se cere din nou după fiecare repornire a aplicației.
            Până o introduci, nu se salvează nimic în iCloud.
          </Text>
          <Pressable
            onPress={onUnlock}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.unlockBtn,
              { borderColor: primary },
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.unlockBtnText, { color: primary }]}>Introdu parola</Text>
          </Pressable>
        </>
      ) : null}
      {cloud.status === 'noBackup' ? (
        <Text style={[styles.hintText, { color: C.textSecondary }]}>
          Primul backup se face când ieși din aplicație sau când apeși „Backup acum".
        </Text>
      ) : null}
      <View style={styles.statRow}>
        <Text style={[styles.statLabel, { color: C.textSecondary }]}>Ultimul backup</Text>
        <Text style={[styles.statValue, { color: C.text }]}>
          {formatTimestamp(cloud.lastUploadedAt)}
        </Text>
      </View>
      <View style={styles.statRow}>
        <Text style={[styles.statLabel, { color: C.textSecondary }]}>Documente</Text>
        <Text style={[styles.statValue, { color: C.text }]}>{cloud.documentCount}</Text>
      </View>
      <View style={styles.statRow}>
        <Text style={[styles.statLabel, { color: C.textSecondary }]}>Bază de date</Text>
        <Text style={[styles.statValue, { color: C.text }]}>{formatBytes(cloud.dbSizeBytes)}</Text>
      </View>
      {cloud.pendingCount > 0 ? (
        <View style={styles.statRow}>
          <Text style={[styles.statLabel, { color: C.textSecondary }]}>În așteptare</Text>
          <Text style={[styles.statValue, { color: C.text }]}>
            {cloud.pendingCount} fișiere · {formatBytes(cloud.pendingBytes)}
          </Text>
        </View>
      ) : null}
      {cloud.failedCount > 0 ? (
        <View style={styles.statRow}>
          <Text style={[styles.statLabel, { color: statusColors.critical }]}>
            {cloud.failedCount}{' '}
            {cloud.failedCount === 1
              ? 'fișier nu a putut fi sincronizat'
              : 'fișiere nu au putut fi sincronizate'}
          </Text>
        </View>
      ) : null}
      {cloud.backupProgress &&
      cloud.backupProgress.phase === 'files' &&
      cloud.backupProgress.total > 0 ? (
        <View style={styles.progressWrap}>
          <Text style={[styles.progressLabel, { color: C.textSecondary }]}>
            Trimit {cloud.backupProgress.current} / {cloud.backupProgress.total} fișiere ·{' '}
            {formatBytes(cloud.backupProgress.bytesDone)} /{' '}
            {formatBytes(cloud.backupProgress.bytesTotal)}
          </Text>
          <View style={[styles.progressBarWrap, { backgroundColor: C.border }]}>
            <View
              style={[
                styles.progressBarFill,
                {
                  backgroundColor: primary,
                  width: `${
                    cloud.backupProgress.bytesTotal > 0
                      ? Math.round(
                          (cloud.backupProgress.bytesDone / cloud.backupProgress.bytesTotal) * 100
                        )
                      : 0
                  }%`,
                },
              ]}
            />
          </View>
        </View>
      ) : null}
      {cloud.backupProgress &&
      (cloud.backupProgress.phase === 'manifest' || cloud.backupProgress.phase === 'snapshot') ? (
        <Text style={[styles.progressLabel, { color: C.textSecondary }]}>
          {cloud.backupProgress.phase === 'manifest'
            ? 'Actualizez manifestul...'
            : 'Salvez snapshot...'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 16, fontWeight: '600' },
  errorText: { fontSize: 13, marginBottom: 8 },
  hintText: { fontSize: 13, lineHeight: 19, marginBottom: 8 },
  unlockBtn: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    marginBottom: 8,
  },
  unlockBtnText: { fontSize: 15, fontWeight: '600' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel: { fontSize: 13 },
  statValue: { fontSize: 13, fontWeight: '600' },
  progressWrap: { marginTop: 12, gap: 6 },
  progressLabel: { fontSize: 12 },
  progressBarWrap: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressBarFill: { height: '100%' },
});
