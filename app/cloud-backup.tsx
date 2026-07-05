import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, ScrollView, View, Text, Alert, Modal } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';
import { useCloudBackup } from '@/hooks/useCloudBackup';
import {
  estimateRestoreSize,
  formatBytes,
  markCloudBackupForReupload,
  restoreFromCloud,
  type RestoreEstimate,
  type RestoreProgress,
} from '@/services/cloudSync';
import {
  getCloudSnapshotFrequency,
  setCloudSnapshotFrequency,
  getCloudSnapshotRetention,
  setCloudSnapshotRetention,
  getCloudEncryptionEnabled,
  setCloudEncryptionEnabled,
} from '@/services/settings';
import {
  PasswordRequiredError,
  clearPassword,
  setSessionKey,
  setupPassword,
  unlockWithPassword,
} from '@/services/cloudCrypto';
import { CloudRestoreProgress } from '@/components/CloudRestoreProgress';
import { CloudPasswordModal, type CloudPasswordModalMode } from '@/components/CloudPasswordModal';
import { QuotaExceededBanner } from '@/components/cloud/QuotaExceededBanner';
import { CloudStatusCard } from '@/components/cloud/CloudStatusCard';
import { SnapshotFrequencyPicker } from '@/components/cloud/SnapshotFrequencyPicker';
import { SnapshotRetentionStepper } from '@/components/cloud/SnapshotRetentionStepper';
import { EncryptionSettingsCard } from '@/components/cloud/EncryptionSettingsCard';
import { CloudActionsCard } from '@/components/cloud/CloudActionsCard';
import { CloudAutoBackupToggle } from '@/components/cloud/CloudAutoBackupToggle';
import type { SnapshotFrequency } from '@/types';

export default function CloudBackupScreen() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const params = useLocalSearchParams<{ action?: string }>();

  const cloud = useCloudBackup();
  const [freq, setFreq] = useState<SnapshotFrequency>('weekly');
  const [retention, setRetention] = useState<number>(4);
  const [loaded, setLoaded] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null);

  // ── Encryption state ─────────────────────────────────────────────────────
  // Notă: nu prompt-ăm parola la mount. O cerem doar când o acțiune (backup
  // sau restore) eșuează cu PasswordRequiredError, sau când userul activează
  // criptarea. O iterație ulterioară poate adăuga unlock-on-screen-mount.
  const [encryptionEnabled, setEncryptionEnabledState] = useState(false);
  const [pwModalMode, setPwModalMode] = useState<CloudPasswordModalMode | null>(null);
  // Acțiunea care a declanșat unlock-ul; rulată după onSubmit reușit.
  const [pendingAfterUnlock, setPendingAfterUnlock] = useState<null | 'backup' | 'restore'>(null);

  // Gate setState pentru restore progress contra unmount (utilizatorul poate
  // naviga înapoi mid-restore — restoreFromCloud continuă să cheme callback-ul).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSetRestoreProgress = useCallback((p: RestoreProgress | null) => {
    if (mountedRef.current) setRestoreProgress(p);
  }, []);

  // One-shot guard pentru deep-link `?action=restore`. `handleRestore` se
  // re-creează la fiecare tick al `cloud` (status ticks etc.); fără guard,
  // efectul re-fire ar deschide Alert-ul de mai multe ori.
  const restoreTriggeredRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const [f, r, enc] = await Promise.all([
        getCloudSnapshotFrequency(),
        getCloudSnapshotRetention(),
        getCloudEncryptionEnabled(),
      ]);
      if (mountedRef.current) {
        setFreq(f);
        setRetention(r);
        setEncryptionEnabledState(enc);
        setLoaded(true);
      }
    })();
  }, []);

  const handleToggle = async (value: boolean) => {
    if (!cloud.available && value) {
      Alert.alert(
        'iCloud indisponibil',
        'Activează iCloud Drive din Setările telefonului pentru a folosi backup-ul în cloud.'
      );
      return;
    }
    await cloud.setEnabled(value);
  };

  // `cloud.backupNow()` rezolvă DUPĂ ce upload + refresh sunt complete
  // (vezi `inFlightBackupRef` în hook). Așadar, după await, backup-ul e
  // finalizat — nu „pornit". Notă: state-ul React citit imediat după await
  // poate fi cu un tick stale; badge-ul se re-randa la următorul refresh.
  const handleBackupNow = async () => {
    await cloud.backupNow();
    // `cloud.error` poate conține mesajul `PasswordRequiredError` re-aruncat
    // de `uploadManifestIfChanged`. Detectăm după mesaj (string starts cu „Parolă").
    const err = cloud.error;
    if (cloud.status === 'error' && err) {
      if (/^Parolă/.test(err)) {
        setPendingAfterUnlock('backup');
        setPwModalMode('unlock');
      } else {
        Alert.alert('Eroare backup', err);
      }
    } else {
      Alert.alert('Backup', 'Backup finalizat.');
    }
  };

  const handleFrequency = async (v: SnapshotFrequency) => {
    setFreq(v);
    await setCloudSnapshotFrequency(v);
  };

  const handleRetention = async (delta: number) => {
    const next = Math.max(1, Math.min(20, retention + delta));
    setRetention(next);
    await setCloudSnapshotRetention(next);
  };

  // Extras într-o variabilă locală ca să închidem strict pe `refresh` în
  // useCallback; folosirea `cloud.refresh` în array-ul de deps ar declanșa
  // exhaustive-deps să ceară `cloud` ca dep, ceea ce ar reintroduce bug-ul de
  // re-fire la fiecare status tick.
  const cloudRefresh = cloud.refresh;
  // Rulează restore-ul efectiv (după ce userul a confirmat sau după unlock).
  const runRestore = useCallback(async () => {
    safeSetRestoreProgress({
      phase: 'manifest',
      current: 0,
      total: 1,
      bytesDone: 0,
      bytesTotal: 0,
    });
    try {
      await restoreFromCloud(safeSetRestoreProgress);
      safeSetRestoreProgress({ phase: 'done', current: 1, total: 1, bytesDone: 0, bytesTotal: 0 });
      Alert.alert('Restaurare', 'Datele au fost restaurate cu succes.');
      await cloudRefresh();
    } catch (e) {
      if (e instanceof PasswordRequiredError) {
        setPendingAfterUnlock('restore');
        setPwModalMode('unlock');
      } else {
        const msg = e instanceof Error ? e.message : 'Eroare necunoscută';
        Alert.alert('Eroare restaurare', msg);
      }
    } finally {
      if (mountedRef.current) setRestoreProgress(null);
    }
  }, [cloudRefresh, safeSetRestoreProgress]);

  const handleRestore = useCallback(async () => {
    let estimate: RestoreEstimate | null = null;
    try {
      estimate = await estimateRestoreSize();
    } catch (e) {
      if (e instanceof PasswordRequiredError) {
        setPendingAfterUnlock('restore');
        setPwModalMode('unlock');
        return;
      }
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Eroare necunoscută');
      return;
    }
    const totalBytes = estimate.manifestBytes + estimate.filesBytes;
    const sizeText =
      estimate.fileCount > 0
        ? `${estimate.fileCount} fișiere · ${formatBytes(totalBytes)}`
        : `Doar manifestul (${formatBytes(totalBytes)})`;
    Alert.alert(
      'Restaurează din iCloud',
      `Vei descărca ${sizeText}. Datele locale curente vor fi înlocuite cu cele din backup. Continui?`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Restaurează',
          style: 'destructive',
          onPress: () => {
            void runRestore();
          },
        },
      ]
    );
  }, [runRestore]);

  // ── Encryption toggle ────────────────────────────────────────────────────
  // La orice schimbare a stării de criptare (activare / dezactivare / schimbare
  // parolă) re-marcăm fișierele deja urcate pentru re-upload și pornim
  // sincronizarea, ca fișierele din iCloud și `meta.encrypted` să rămână coerente
  // (altfel restore-ul citește greșit fișierele urcate cu starea veche).
  const handleEncryptionToggle = (value: boolean) => {
    if (value) {
      // OFF → ON: avertizează despre re-criptare, apoi cere parolă nouă.
      Alert.alert(
        'Activează criptarea',
        'Criptarea se aplică imediat fișierelor noi. Fișierele deja urcate în iCloud sunt ' +
          're-criptate la următoarea sincronizare, care pornește automat după ce setezi parola. ' +
          'Poți folosi aplicația în acest timp. Continui?',
        [
          { text: 'Anulează', style: 'cancel' },
          {
            text: 'Activează',
            onPress: () => {
              setPendingAfterUnlock(null);
              // setTimeout: pe iOS, UIAlertController e încă în animația de dismiss când
              // onPress fire-uiește; prezentarea CloudPasswordModal (un <Modal>) în acel
              // moment eșuează silent. 350ms lasă alertul să se închidă (audit alert-modal-race).
              setTimeout(() => setPwModalMode('setup'), 350);
            },
          },
        ]
      );
      return;
    }
    // ON → OFF: fișierele deja criptate din iCloud devin nedecriptabile după ce ștergem
    // parola (salt + verify). `meta.encrypted` global nu suportă o stare mixtă, așa că
    // pentru a păstra backup-ul restaurabil re-urcăm TOATE fișierele necriptat la
    // următoarea sincronizare (pornește automat), convergând spre „tot plaintext".
    Alert.alert(
      'Dezactivează criptarea',
      'Backup-urile viitoare vor fi necriptate. Fișierele deja criptate din iCloud vor fi ' +
        're-urcate necriptat la următoarea sincronizare (pornește automat), ca backup-ul să ' +
        'rămână restaurabil. Parola de criptare va fi ștearsă. Continui?',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Dezactivează',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearPassword();
              await setCloudEncryptionEnabled(false);
              setEncryptionEnabledState(false);
              await markCloudBackupForReupload();
              await cloudRefresh();
              // Pornim re-urcarea necriptată imediat, fără să așteptăm o modificare de date.
              await cloud.backupNow();
            } catch (e) {
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Eroare necunoscută');
            }
          },
        },
      ]
    );
  };

  const handleChangePassword = () => {
    Alert.alert(
      'Schimbă parola',
      'Atenție: toate backup-urile criptate cu parola curentă vor deveni nedecriptabile. ' +
        'Va fi nevoie să faci un backup nou imediat după schimbare. Continui?',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Continuă',
          style: 'destructive',
          onPress: () => {
            setPendingAfterUnlock(null);
            // setTimeout: lasă Alert-ul iOS să se închidă complet înainte de a prezenta
            // CloudPasswordModal (present-on-presenting eșuează silent — audit alert-modal-race).
            setTimeout(() => setPwModalMode('setup'), 350);
          },
        },
      ]
    );
  };

  const handlePasswordSubmit = async (password: string) => {
    if (pwModalMode === 'setup') {
      // Atins din „Activează criptarea" (OFF → ON) ȘI din „Schimbă parola" (ON → ON).
      // Ambele necesită re-criptarea fișierelor deja urcate cu NOUA cheie: la activare
      // erau plaintext, la schimbare parolă erau criptate cu cheia veche (nedecriptabile
      // cu cea nouă). Fără re-upload ar rămâne incompatibile cu `meta.encrypted` nou.
      const key = await setupPassword(password);
      setSessionKey(key);
      await setCloudEncryptionEnabled(true);
      setEncryptionEnabledState(true);
      setPwModalMode(null);
      await markCloudBackupForReupload();
      await cloudRefresh();
      // Pornim re-criptarea imediat, fără să așteptăm o modificare de date. backupNow nu
      // aruncă (înghite erorile în state-ul hook-ului), deci nu re-deschide modalul cu eroare.
      await cloud.backupNow();
      return;
    }
    // mode === 'unlock'
    const key = await unlockWithPassword(password);
    setSessionKey(key);
    setPwModalMode(null);
    if (pendingAfterUnlock === 'backup') {
      setPendingAfterUnlock(null);
      await cloud.backupNow();
    } else if (pendingAfterUnlock === 'restore') {
      setPendingAfterUnlock(null);
      await runRestore();
    } else {
      await cloudRefresh();
    }
  };

  const handlePasswordCancel = () => {
    setPwModalMode(null);
    setPendingAfterUnlock(null);
  };

  useEffect(() => {
    if (params.action === 'restore' && !restoreTriggeredRef.current) {
      restoreTriggeredRef.current = true;
      void handleRestore();
    }
  }, [params.action, handleRestore]);

  const restoreModalDismissable = restoreProgress?.phase === 'done';

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ title: 'iCloud Backup', headerShown: true }} />
      <ScrollView contentContainerStyle={styles.content}>
        {cloud.quotaExceeded ? (
          <QuotaExceededBanner scheme={scheme === 'dark' ? 'dark' : 'light'} />
        ) : null}

        <CloudStatusCard cloud={cloud} scheme={scheme === 'dark' ? 'dark' : 'light'} />

        {/* ── Toggle ── */}
        <CloudAutoBackupToggle
          scheme={scheme === 'dark' ? 'dark' : 'light'}
          enabled={cloud.enabled}
          available={cloud.available}
          loading={cloud.loading}
          onToggle={handleToggle}
        />

        {/* ── Frecvență snapshot ── */}
        <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>
          FRECVENȚĂ SNAPSHOT
        </Text>
        <SnapshotFrequencyPicker
          scheme={scheme === 'dark' ? 'dark' : 'light'}
          value={freq}
          loading={!loaded}
          onChange={handleFrequency}
        />

        {/* ── Retenție snapshot ── */}
        <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>
          NUMĂR SNAPSHOT-URI PĂSTRATE
        </Text>
        <SnapshotRetentionStepper
          scheme={scheme === 'dark' ? 'dark' : 'light'}
          value={retention}
          loading={!loaded}
          onChange={handleRetention}
        />
        {loaded && (
          <Text
            style={{
              color: palette.textSecondary,
              fontSize: 12,
              lineHeight: 18,
              marginTop: -4,
              marginBottom: 12,
              marginLeft: 4,
            }}
          >
            Snapshot-urile mai vechi sunt șterse automat din iCloud.
          </Text>
        )}

        {/* ── Criptare backup ── */}
        <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>CRIPTARE BACKUP</Text>
        <EncryptionSettingsCard
          scheme={scheme === 'dark' ? 'dark' : 'light'}
          enabled={encryptionEnabled}
          loaded={loaded}
          onToggle={handleEncryptionToggle}
          onChangePassword={handleChangePassword}
        />

        {/* ── Acțiuni ── */}
        <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>ACȚIUNI</Text>
        <CloudActionsCard
          scheme={scheme === 'dark' ? 'dark' : 'light'}
          enabled={cloud.enabled}
          available={cloud.available}
          uploading={cloud.status === 'uploading'}
          restoreInProgress={restoreProgress !== null}
          onBackupNow={handleBackupNow}
          onRestore={handleRestore}
        />
      </ScrollView>

      <Modal
        visible={restoreProgress !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (restoreModalDismissable) setRestoreProgress(null);
        }}
      >
        <View style={[styles.modalBackdrop, { backgroundColor: `${palette.text}80` }]}>
          <CloudRestoreProgress progress={restoreProgress} />
        </View>
      </Modal>

      <CloudPasswordModal
        visible={pwModalMode !== null}
        mode={pwModalMode ?? 'unlock'}
        onSubmit={handlePasswordSubmit}
        onCancel={handlePasswordCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 40 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },

  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
});
