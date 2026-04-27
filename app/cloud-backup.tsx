import { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  View,
  Text,
  Pressable,
  Switch,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, onPrimary, statusColors } from '@/theme/colors';
import { useCloudBackup } from '@/hooks/useCloudBackup';
import { restoreFromCloud, type RestoreProgress } from '@/services/cloudSync';
import {
  getCloudSnapshotFrequency,
  setCloudSnapshotFrequency,
  getCloudSnapshotRetention,
  setCloudSnapshotRetention,
} from '@/services/settings';
import { CloudRestoreProgress } from '@/components/CloudRestoreProgress';
import type { SnapshotFrequency, CloudStatus } from '@/types';

const FREQUENCY_OPTIONS: { value: SnapshotFrequency; label: string }[] = [
  { value: 'off', label: 'Dezactivat' },
  { value: 'daily', label: 'Zilnic' },
  { value: 'every3days', label: 'La 3 zile' },
  { value: 'weekly', label: 'Săptămânal' },
  { value: 'monthly', label: 'Lunar' },
];

const STATUS_LABELS: Record<CloudStatus, string> = {
  idle: 'Sincronizat',
  uploading: 'Se sincronizează...',
  restoring: 'Se restaurează...',
  error: 'Eroare',
  paused: 'Dezactivat',
  unavailable: 'iCloud indisponibil',
};

function statusColor(status: CloudStatus): string {
  switch (status) {
    case 'idle':
      return statusColors.ok;
    case 'uploading':
    case 'restoring':
      return statusColors.warning;
    case 'error':
    case 'unavailable':
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

export default function CloudBackupScreen() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const params = useLocalSearchParams<{ action?: string }>();

  const cloud = useCloudBackup();
  const [freq, setFreq] = useState<SnapshotFrequency>('weekly');
  const [retention, setRetention] = useState<number>(4);
  const [loaded, setLoaded] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState<RestoreProgress | null>(null);

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
      const [f, r] = await Promise.all([getCloudSnapshotFrequency(), getCloudSnapshotRetention()]);
      if (mountedRef.current) {
        setFreq(f);
        setRetention(r);
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
    if (cloud.status === 'error' && cloud.error) {
      Alert.alert('Eroare backup', cloud.error);
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
  const handleRestore = useCallback(async () => {
    Alert.alert(
      'Restaurează din iCloud',
      'Datele locale curente vor fi înlocuite cu cele din backup-ul iCloud. Continui?',
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Restaurează',
          style: 'destructive',
          onPress: async () => {
            safeSetRestoreProgress({ phase: 'manifest', current: 0, total: 1 });
            try {
              await restoreFromCloud(safeSetRestoreProgress);
              safeSetRestoreProgress({ phase: 'done', current: 1, total: 1 });
              Alert.alert('Restaurare', 'Datele au fost restaurate cu succes.');
              await cloudRefresh();
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Eroare necunoscută';
              Alert.alert('Eroare restaurare', msg);
            } finally {
              if (mountedRef.current) setRestoreProgress(null);
            }
          },
        },
      ]
    );
  }, [cloudRefresh, safeSetRestoreProgress]);

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
        {/* ── Status ── */}
        <View
          style={[styles.card, { backgroundColor: palette.card, shadowColor: palette.cardShadow }]}
        >
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor(cloud.status) }]} />
            <Text style={[styles.statusLabel, { color: palette.text }]}>
              {STATUS_LABELS[cloud.status]}
            </Text>
          </View>
          {cloud.error ? (
            <Text style={[styles.errorText, { color: statusColors.critical }]}>{cloud.error}</Text>
          ) : null}
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: palette.textSecondary }]}>Ultimul backup</Text>
            <Text style={[styles.statValue, { color: palette.text }]}>
              {formatTimestamp(cloud.lastUploadedAt)}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: palette.textSecondary }]}>Documente</Text>
            <Text style={[styles.statValue, { color: palette.text }]}>{cloud.documentCount}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={[styles.statLabel, { color: palette.textSecondary }]}>În așteptare</Text>
            <Text style={[styles.statValue, { color: palette.text }]}>{cloud.pendingCount}</Text>
          </View>
        </View>

        {/* ── Toggle ── */}
        <View
          style={[styles.card, { backgroundColor: palette.card, shadowColor: palette.cardShadow }]}
        >
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={[styles.toggleLabel, { color: palette.text }]}>
                Backup automat iCloud
              </Text>
              <Text style={[styles.toggleSub, { color: palette.textSecondary }]}>
                Sincronizează automat manifestul și fișierele când app-ul intră în fundal.
              </Text>
            </View>
            <Switch
              value={cloud.enabled}
              onValueChange={handleToggle}
              disabled={cloud.loading}
              trackColor={{ false: palette.border, true: primary }}
              thumbColor={onPrimary}
            />
          </View>
          {!cloud.available ? (
            <Text style={[styles.hint, { color: palette.textSecondary }]}>
              iCloud Drive nu este disponibil pe acest dispozitiv. Activează-l din Setările
              telefonului.
            </Text>
          ) : null}
        </View>

        {/* ── Frecvență snapshot ── */}
        <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>
          FRECVENȚĂ SNAPSHOT
        </Text>
        <View
          style={[styles.card, { backgroundColor: palette.card, shadowColor: palette.cardShadow }]}
        >
          {!loaded ? (
            <View style={styles.skeletonRow}>
              <ActivityIndicator size="small" color={primary} />
            </View>
          ) : (
            FREQUENCY_OPTIONS.map((opt, idx) => {
              const selected = freq === opt.value;
              const isLast = idx === FREQUENCY_OPTIONS.length - 1;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => handleFrequency(opt.value)}
                  style={({ pressed }) => [
                    styles.optionRow,
                    !isLast && {
                      borderBottomColor: palette.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.optionLabel, { color: palette.text }]}>{opt.label}</Text>
                  {selected ? <Ionicons name="checkmark" size={20} color={primary} /> : null}
                </Pressable>
              );
            })
          )}
        </View>

        {/* ── Retenție snapshot ── */}
        <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>
          NUMĂR SNAPSHOT-URI PĂSTRATE
        </Text>
        <View
          style={[styles.card, { backgroundColor: palette.card, shadowColor: palette.cardShadow }]}
        >
          {!loaded ? (
            <View style={styles.skeletonRow}>
              <ActivityIndicator size="small" color={primary} />
            </View>
          ) : (
            <>
              <View style={styles.retentionRow}>
                <Text style={[styles.toggleLabel, { color: palette.text }]}>
                  Păstrează ultimele
                </Text>
                <View style={styles.stepperRow}>
                  <Pressable
                    onPress={() => handleRetention(-1)}
                    disabled={retention <= 1}
                    style={({ pressed }) => [
                      styles.stepperBtn,
                      { borderColor: palette.border },
                      pressed && { opacity: 0.6 },
                      retention <= 1 && { opacity: 0.4 },
                    ]}
                    hitSlop={8}
                  >
                    <Ionicons name="remove" size={18} color={palette.text} />
                  </Pressable>
                  <Text style={[styles.retText, { color: palette.text }]}>{retention}</Text>
                  <Pressable
                    onPress={() => handleRetention(1)}
                    disabled={retention >= 20}
                    style={({ pressed }) => [
                      styles.stepperBtn,
                      { borderColor: palette.border },
                      pressed && { opacity: 0.6 },
                      retention >= 20 && { opacity: 0.4 },
                    ]}
                    hitSlop={8}
                  >
                    <Ionicons name="add" size={18} color={palette.text} />
                  </Pressable>
                </View>
              </View>
              <Text style={[styles.hint, { color: palette.textSecondary }]}>
                Snapshot-urile mai vechi sunt șterse automat din iCloud.
              </Text>
            </>
          )}
        </View>

        {/* ── Acțiuni ── */}
        <Text style={[styles.sectionLabel, { color: palette.textSecondary }]}>ACȚIUNI</Text>
        <View
          style={[styles.card, { backgroundColor: palette.card, shadowColor: palette.cardShadow }]}
        >
          <Pressable
            onPress={handleBackupNow}
            disabled={!cloud.enabled || !cloud.available || cloud.status === 'uploading'}
            style={({ pressed }) => [
              styles.btn,
              { backgroundColor: primary },
              (pressed || !cloud.enabled || !cloud.available || cloud.status === 'uploading') && {
                opacity: 0.6,
              },
            ]}
          >
            {cloud.status === 'uploading' ? (
              <ActivityIndicator size="small" color={onPrimary} style={styles.btnIcon} />
            ) : (
              <Ionicons
                name="cloud-upload-outline"
                size={18}
                color={onPrimary}
                style={styles.btnIcon}
              />
            )}
            <Text style={[styles.btnText, { color: onPrimary }]}>
              {cloud.status === 'uploading' ? 'Se sincronizează...' : 'Backup acum'}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleRestore}
            disabled={!cloud.available || restoreProgress !== null}
            style={({ pressed }) => [
              styles.btnOutline,
              { borderColor: primary },
              (pressed || !cloud.available || restoreProgress !== null) && { opacity: 0.6 },
            ]}
          >
            <Ionicons
              name="cloud-download-outline"
              size={18}
              color={primary}
              style={styles.btnIcon}
            />
            <Text style={[styles.btnOutlineText, { color: primary }]}>Restaurează din iCloud</Text>
          </Pressable>
          <Text style={[styles.hint, { color: palette.textSecondary }]}>
            Restaurarea înlocuiește toate datele locale cu cele din backup-ul iCloud.
          </Text>
        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 40 },

  card: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 16, fontWeight: '600' },
  errorText: { fontSize: 13, marginBottom: 8 },

  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statLabel: { fontSize: 13 },
  statValue: { fontSize: 13, fontWeight: '600' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleTextWrap: { flex: 1 },
  toggleLabel: { fontSize: 15, fontWeight: '500' },
  toggleSub: { fontSize: 12, marginTop: 2, lineHeight: 16 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: 8,
    marginTop: 8,
    marginLeft: 4,
    textTransform: 'uppercase',
  },

  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  optionLabel: { fontSize: 15 },

  skeletonRow: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  retentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retText: { fontSize: 16, fontWeight: '600', minWidth: 24, textAlign: 'center' },

  hint: { fontSize: 12, lineHeight: 18, marginTop: 8 },

  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 10,
    marginTop: 4,
  },
  btnIcon: { marginRight: 8 },
  btnText: { fontSize: 15, fontWeight: '600' },
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

  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
});
