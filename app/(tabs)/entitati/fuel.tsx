import { useCallback, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  TextInput,
  Switch,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useTheme } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Text, View } from '@/components/Themed';
import { primary } from '@/theme/colors';
import {
  getFuelRecords,
  addFuelRecord,
  deleteFuelRecord,
  getFuelSettings,
  saveFuelSettings,
  computeFuelStats,
} from '@/services/fuel';
import { extractText, extractFuelInfo } from '@/services/ocr';
import type { FuelRecord, VehicleFuelSettings, FuelStats } from '@/services/fuel';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function FuelScreen() {
  const { vehicleId, vehicleName } = useLocalSearchParams<{
    vehicleId: string;
    vehicleName: string;
  }>();
  const { colors } = useTheme();

  const [records, setRecords] = useState<FuelRecord[]>([]);
  const [stats, setStats] = useState<FuelStats | null>(null);
  const [settings, setSettings] = useState<VehicleFuelSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // settings edit state
  const [settingsInterval, setSettingsInterval] = useState('');
  const [settingsLastKm, setSettingsLastKm] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);

  // modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [mDate, setMDate] = useState('');
  const [mLiters, setMLiters] = useState('');
  const [mKm, setMKm] = useState('');
  const [mPrice, setMPrice] = useState('');
  const [mLoading, setMLoading] = useState(false);
  const [mIsFull, setMIsFull] = useState(true);

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const [recs, stts, setts] = await Promise.all([
        getFuelRecords(vehicleId),
        computeFuelStats(vehicleId),
        getFuelSettings(vehicleId),
      ]);
      setRecords(recs);
      setStats(stts);
      setSettings(setts);
      setSettingsInterval(String(setts.service_km_interval || ''));
      setSettingsLastKm(setts.last_service_km !== undefined ? String(setts.last_service_km) : '');
    } catch {
      Alert.alert('Eroare', 'Nu s-au putut încărca datele de carburant.');
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!vehicleId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>ID vehicul lipsă. Navighează din ecranul entității.</Text>
      </View>
    );
  }

  async function handleSaveSettings() {
    if (!vehicleId) return;
    const interval = parseInt(settingsInterval, 10);
    if (isNaN(interval) || interval <= 0) {
      Alert.alert('Eroare', 'Intervalul de revizie trebuie să fie un număr pozitiv.');
      return;
    }
    setSettingsSaving(true);
    try {
      const update: Partial<VehicleFuelSettings> = { service_km_interval: interval };
      const lastKmNum = parseInt(settingsLastKm, 10);
      if (!isNaN(lastKmNum) && lastKmNum > 0) {
        update.last_service_km = lastKmNum;
      }
      await saveFuelSettings(vehicleId, update);
      await load();
    } catch {
      Alert.alert('Eroare', 'Nu s-au putut salva setările.');
    } finally {
      setSettingsSaving(false);
    }
  }

  function openModal() {
    setMDate(todayIso());
    setMLiters('');
    setMKm('');
    setMPrice('');
    setMIsFull(true);
    setModalVisible(true);
  }

  async function handleScanReceipt() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisiune refuzată', 'Aplicația nu are acces la cameră.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.9 });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const uri = result.assets[0].uri;
    setMLoading(true);
    try {
      const { text } = await extractText(uri);
      const info = extractFuelInfo(text);
      if (!info.liters && !info.km && !info.price && !info.date) {
        Alert.alert('OCR', 'Nu s-au putut extrage date din bon. Completează manual.');
      } else {
        if (info.date) setMDate(info.date);
        if (info.liters !== undefined) setMLiters(String(info.liters));
        if (info.km !== undefined) setMKm(String(info.km));
        if (info.price !== undefined) setMPrice(String(info.price));
      }
    } catch {
      Alert.alert('Eroare OCR', 'Nu s-a putut citi bonul. Completează manual.');
    } finally {
      setMLoading(false);
    }
  }

  async function handleSaveRecord() {
    if (!vehicleId) return;
    if (!mDate.trim()) {
      Alert.alert('Eroare', 'Data este obligatorie.');
      return;
    }
    setMLoading(true);
    try {
      const liters = mLiters.trim() ? parseFloat(mLiters) : undefined;
      const km = mKm.trim() ? parseInt(mKm, 10) : undefined;
      const price = mPrice.trim() ? parseFloat(mPrice) : undefined;
      await addFuelRecord(vehicleId, {
        date: mDate.trim(),
        liters,
        km_total: km,
        price,
        is_full: mIsFull,
      });
      setModalVisible(false);
      await load();
    } catch {
      Alert.alert('Eroare', 'Nu s-a putut salva înregistrarea.');
    } finally {
      setMLoading(false);
    }
  }

  function handleDeleteRecord(record: FuelRecord) {
    Alert.alert('Șterge înregistrare', `Ștergi bonul din ${record.date}?`, [
      { text: 'Anulare', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteFuelRecord(record.id);
            await load();
          } catch {
            Alert.alert('Eroare', 'Nu s-a putut șterge înregistrarea.');
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      {/* Stats bar */}
      {stats && (
        <View style={styles.statsBar}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalRecords}</Text>
            <Text style={styles.statLabel}>înreg.</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>
              {stats.avgConsumptionL100 !== undefined
                ? `${stats.avgConsumptionL100.toFixed(1)}`
                : 'N/A'}
            </Text>
            <Text style={styles.statLabel}>L/100km</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalLiters.toFixed(1)}</Text>
            <Text style={styles.statLabel}>L total</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.totalCost.toFixed(2)}</Text>
            <Text style={styles.statLabel}>RON</Text>
          </View>
        </View>
      )}

      {stats?.needsService && (
        <View style={styles.serviceBanner}>
          <Text style={styles.serviceBannerText}>
            ⚠️ Revizie depășită!
            {stats.kmUntilService !== undefined
              ? ` (${Math.abs(stats.kmUntilService)} km depășit)`
              : ''}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Setări revizie */}
        <View style={[styles.settingsSection, { backgroundColor: colors.card }]}>
          <Text style={styles.sectionTitle}>Setări revizie</Text>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Interval revizie (km):</Text>
            <TextInput
              style={[styles.settingsInput, { borderColor: '#e0e0e0', color: colors.text }]}
              value={settingsInterval}
              onChangeText={setSettingsInterval}
              keyboardType="number-pad"
              placeholder="Ex: 10000"
              placeholderTextColor="#aaa"
            />
          </View>

          <View style={styles.settingsRow}>
            <Text style={styles.settingsLabel}>Ultima revizie la km:</Text>
            <TextInput
              style={[styles.settingsInput, { borderColor: '#e0e0e0', color: colors.text }]}
              value={settingsLastKm}
              onChangeText={setSettingsLastKm}
              keyboardType="number-pad"
              placeholder="Ex: 120000"
              placeholderTextColor="#aaa"
            />
          </View>

          <Pressable
            style={({ pressed }) => [styles.saveSettingsBtn, pressed && styles.btnPressed]}
            onPress={handleSaveSettings}
            disabled={settingsSaving}
          >
            <Text style={styles.saveSettingsBtnText}>
              {settingsSaving ? 'Se salvează...' : 'Salvează setări'}
            </Text>
          </Pressable>
        </View>

        {/* Lista înregistrări */}
        <Text style={styles.sectionTitle}>Istoric bonuri</Text>

        {loading && <ActivityIndicator color={primary} style={{ marginVertical: 20 }} />}

        {!loading && records.length === 0 && (
          <Text style={styles.empty}>Nicio înregistrare. Adaugă primul bon.</Text>
        )}

        {records.map(record => (
          <Pressable
            key={record.id}
            style={({ pressed }) => [
              styles.recordCard,
              { backgroundColor: colors.card },
              pressed && styles.btnPressed,
            ]}
            onLongPress={() => handleDeleteRecord(record)}
          >
            <View style={styles.recordHeader}>
              <View style={styles.recordHeaderLeft}>
                <Text style={styles.recordDate}>{record.date}</Text>
                {!record.is_full && (
                  <View style={styles.partialChip}>
                    <Text style={styles.partialChipText}>PARȚIAL</Text>
                  </View>
                )}
              </View>
              {record.price !== undefined && (
                <Text style={styles.recordPrice}>{record.price.toFixed(2)} RON</Text>
              )}
            </View>
            <View style={styles.recordDetails}>
              {record.liters !== undefined && (
                <Text style={styles.recordMeta}>{record.liters.toFixed(2)} L</Text>
              )}
              {record.km_total !== undefined && (
                <Text style={styles.recordMeta}>{record.km_total.toLocaleString('ro-RO')} km</Text>
              )}
            </View>
            <Text style={styles.recordHint}>Apasă lung pentru a șterge</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Buton adaugă bon */}
      <Pressable
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
        onPress={openModal}
      >
        <Text style={styles.fabText}>+ Adaugă bon</Text>
      </Pressable>

      {/* Modal adaugă bon */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Bon motorină</Text>

            {/* OCR */}
            <Pressable
              style={({ pressed }) => [styles.ocrBtn, pressed && styles.btnPressed]}
              onPress={handleScanReceipt}
              disabled={mLoading}
            >
              <Text style={styles.ocrBtnText}>
                {mLoading ? 'Se procesează...' : '📷 Fotografiază bonul (OCR)'}
              </Text>
            </Pressable>

            <Text style={styles.modalLabel}>Data</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: '#e0e0e0', color: colors.text }]}
              value={mDate}
              onChangeText={setMDate}
              placeholder="AAAA-LL-ZZ"
              placeholderTextColor="#aaa"
              editable={!mLoading}
            />

            <Text style={styles.modalLabel}>Litri</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: '#e0e0e0', color: colors.text }]}
              value={mLiters}
              onChangeText={setMLiters}
              placeholder="Ex: 45.23"
              placeholderTextColor="#aaa"
              keyboardType="decimal-pad"
              editable={!mLoading}
            />

            <Text style={styles.modalLabel}>KM total (odometru)</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: '#e0e0e0', color: colors.text }]}
              value={mKm}
              onChangeText={setMKm}
              placeholder="Ex: 125430"
              placeholderTextColor="#aaa"
              keyboardType="number-pad"
              editable={!mLoading}
            />

            <View style={styles.isFullRow}>
              <Text style={styles.modalLabel}>Plin complet</Text>
              <Switch
                value={mIsFull}
                onValueChange={setMIsFull}
                trackColor={{ false: '#ccc', true: primary }}
                disabled={mLoading}
              />
            </View>
            {!mIsFull && (
              <Text style={styles.isFullHint}>
                Litrii nu vor fi contați în consum până la următorul plin complet.
              </Text>
            )}

            <Text style={styles.modalLabel}>Preț total (RON)</Text>
            <TextInput
              style={[styles.modalInput, { borderColor: '#e0e0e0', color: colors.text }]}
              value={mPrice}
              onChangeText={setMPrice}
              placeholder="Ex: 280.50"
              placeholderTextColor="#aaa"
              keyboardType="decimal-pad"
              editable={!mLoading}
            />

            <View style={styles.modalButtons}>
              <Pressable
                style={({ pressed }) => [styles.modalCancelBtn, pressed && styles.btnPressed]}
                onPress={() => setModalVisible(false)}
                disabled={mLoading}
              >
                <Text style={styles.modalCancelText}>Anulare</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalSaveBtn, pressed && styles.btnPressed]}
                onPress={handleSaveRecord}
                disabled={mLoading}
              >
                <Text style={styles.modalSaveText}>{mLoading ? 'Se salvează...' : 'Salvează'}</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 16, opacity: 0.7, textAlign: 'center' },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    backgroundColor: 'transparent',
  },
  statCard: {
    flex: 1,
    backgroundColor: '#f8f8f8',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  statValue: { fontSize: 15, fontWeight: '700', color: primary },
  statLabel: { fontSize: 11, opacity: 0.6, marginTop: 2, textAlign: 'center' },

  // Service banner
  serviceBanner: {
    marginHorizontal: 12,
    marginBottom: 8,
    backgroundColor: '#fff0f0',
    borderWidth: 1,
    borderColor: '#e00',
    borderRadius: 10,
    padding: 12,
  },
  serviceBannerText: { color: '#c00', fontWeight: '600', fontSize: 14, textAlign: 'center' },

  scroll: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 90 },

  // Settings section
  settingsSection: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 14 },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: 'transparent',
  },
  settingsLabel: { flex: 1, fontSize: 14, opacity: 0.85 },
  settingsInput: {
    width: 110,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  saveSettingsBtn: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveSettingsBtnText: { color: primary, fontWeight: '600', fontSize: 15 },

  // Records
  empty: { opacity: 0.6, fontSize: 14, marginBottom: 16, textAlign: 'center' },
  recordCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'transparent',
    marginBottom: 6,
  },
  recordHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  partialChip: {
    backgroundColor: 'rgba(232,165,58,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  partialChipText: {
    color: '#E8A53A',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  recordDate: { fontSize: 15, fontWeight: '600' },
  recordPrice: { fontSize: 15, fontWeight: '700', color: primary },
  recordDetails: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: 'transparent',
  },
  recordMeta: { fontSize: 13, opacity: 0.7 },
  recordHint: { fontSize: 11, opacity: 0.35, marginTop: 6 },

  btnPressed: { opacity: 0.7 },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: primary,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  fabPressed: { opacity: 0.85 },
  fabText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  modalLabel: { fontSize: 13, opacity: 0.8, marginBottom: 5 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 14,
    backgroundColor: '#fafafa',
  },
  ocrBtn: {
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 18,
  },
  ocrBtnText: { color: primary, fontSize: 15, fontWeight: '600' },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
    backgroundColor: 'transparent',
  },
  modalCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 15, opacity: 0.8 },
  modalSaveBtn: {
    flex: 1,
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalSaveText: { color: '#fff', fontSize: 15, fontWeight: '600' },

  isFullRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
    marginBottom: 8,
  },
  isFullHint: {
    fontSize: 11,
    fontStyle: 'italic',
    opacity: 0.7,
    marginBottom: 14,
  },
});
