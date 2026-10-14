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
  unlockCloudBackupKey,
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
  // Pasul de după parolă rulează abia când modalul a dispărut (onDismissed):
  // confirmarea restaurării e un Alert, iar progresul e un alt <Modal>.
  const afterPasswordRef = useRef<(() => void) | null>(null);
  // Restaurarea a cerut parola în timp ce modalul de progres era deschis: o cerem
  // după ce acela dispare.
  const askPasswordAfterProgressRef = useRef(false);

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

  // Mesajul vine din rezultatul întors de `backupNow`, nu din `cloud.status` /
  // `cloud.error`: aceia sunt din render-ul de dinainte de apăsare (afișau
  // „Backup finalizat." și când backup-ul eșua).
  const handleBackupNow = async () => {
    const result = await cloud.backupNow();
    if (result.passwordRequired) {
      setPendingAfterUnlock('backup');
      setPwModalMode('unlock');
    } else if (result.error) {
      Alert.alert('Eroare backup', result.error);
    } else if (result.failedFiles > 0) {
      const n = result.failedFiles;
      Alert.alert(
        'Backup incomplet',
        `${n} ${n === 1 ? 'fișier nu a putut fi urcat' : 'fișiere nu au putut fi urcate'} în iCloud. Restul backup-ului e salvat.`
      );
    } else if (result.otherDeviceBackup) {
      Alert.alert(
        'Backup de pe alt telefon',
        'Backup-ul din iCloud a fost făcut de pe alt telefon, după ultimul backup de aici. Nu l-am înlocuit, pentru că pe acest telefon nu s-a schimbat nimic de atunci.'
      );
    } else if (!result.changed) {
      Alert.alert('Backup', 'Backup-ul din iCloud era deja la zi. Nu a fost nimic nou de urcat.');
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
  // Rulează restore-ul efectiv, după confirmare. `key` = cheia backup-ului criptat,
  // derivată din parola introdusă (merge și pe un telefon fără setup local).
  const runRestore = useCallback(
    async (key?: Uint8Array) => {
      safeSetRestoreProgress({
        phase: 'manifest',
        current: 0,
        total: 1,
        bytesDone: 0,
        bytesTotal: 0,
      });
      try {
        await restoreFromCloud(safeSetRestoreProgress, key);
        safeSetRestoreProgress({
          phase: 'done',
          current: 1,
          total: 1,
          bytesDone: 0,
          bytesTotal: 0,
        });
        // Restaurarea poate porni sau opri criptarea (preia starea backup-ului).
        setEncryptionEnabledState(await getCloudEncryptionEnabled());
        Alert.alert('Restaurare', 'Datele au fost restaurate cu succes.');
        await cloudRefresh();
      } catch (e) {
        // Fără cheie: cere parola. Cu o cheie deja introdusă, eroarea spune de ce nu
        // merge (ex. parola nu decriptează manifestul) — redeschiderea modalului ar
        // repeta la infinit, fără explicație.
        if (e instanceof PasswordRequiredError && !key) {
          askPasswordAfterProgressRef.current = true;
        } else {
          const msg = e instanceof Error ? e.message : 'Eroare necunoscută';
          Alert.alert('Eroare restaurare', msg);
        }
      } finally {
        if (mountedRef.current) setRestoreProgress(null);
      }
    },
    [cloudRefresh, safeSetRestoreProgress]
  );

  const handleRestore = useCallback(
    async (key?: Uint8Array) => {
      let estimate: RestoreEstimate | null = null;
      try {
        estimate = await estimateRestoreSize(key);
      } catch (e) {
        if (e instanceof PasswordRequiredError && !key) {
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
              // Modalul de progres se deschide după ce Alert-ul a dispărut (iOS).
              setTimeout(() => void runRestore(key), 350);
            },
          },
        ]
      );
    },
    [runRestore]
  );

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
    if (pendingAfterUnlock === 'restore') {
      // Parola backup-ului din iCloud, verificată cu parametrii din meta: merge și pe
      // un telefon nou. Cheia devine cheia telefonului abia după restaurare.
      const key = await unlockCloudBackupKey(password);
      afterPasswordRef.current = () => void handleRestore(key);
    } else {
      const key = await unlockWithPassword(password);
      setSessionKey(key);
      afterPasswordRef.current =
        pendingAfterUnlock === 'backup' ? () => void handleBackupNow() : () => void cloudRefresh();
    }
    setPendingAfterUnlock(null);
    setPwModalMode(null);
  };

  const handlePasswordCancel = () => {
    afterPasswordRef.current = null;
    setPwModalMode(null);
    setPendingAfterUnlock(null);
  };

  const handlePasswordDismissed = () => {
    const next = afterPasswordRef.current;
    afterPasswordRef.current = null;
    next?.();
  };

  const handleRestoreProgressDismissed = () => {
    if (!askPasswordAfterProgressRef.current) return;
    askPasswordAfterProgressRef.current = false;
    setPendingAfterUnlock('restore');
    setPwModalMode('unlock');
  };

  const handleUnlockBackup = () => {
    setPendingAfterUnlock('backup');
    setPwModalMode('unlock');
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

        <CloudStatusCard
          cloud={cloud}
          scheme={scheme === 'dark' ? 'dark' : 'light'}
          onUnlock={handleUnlockBackup}
        />

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
          onRestore={() => void handleRestore()}
        />
      </ScrollView>

      <Modal
        visible={restoreProgress !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (restoreModalDismissable) setRestoreProgress(null);
        }}
        onDismiss={handleRestoreProgressDismissed}
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
        onDismissed={handlePasswordDismissed}
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
