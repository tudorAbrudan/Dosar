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
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { primary, light, dark } from '@/theme/colors';
import { DatePickerField } from '@/components/DatePickerField';
import { FuelConsumptionChart } from '@/components/FuelConsumptionChart';
import {
  getFuelRecords,
  addFuelRecord,
  updateFuelRecord,
  deleteFuelRecord,
  computeFuelStats,
} from '@/services/fuel';
import { extractText, extractFuelInfo } from '@/services/ocr';
import type { FuelRecord, FuelStats } from '@/services/fuel';
import { useFinancialAccounts } from '@/hooks/useFinancialAccounts';
import { Ionicons } from '@expo/vector-icons';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function FuelScreen() {
  const { vehicleId, vehicleName } = useLocalSearchParams<{
    vehicleId: string;
    vehicleName: string;
  }>();
  const router = useRouter();
  const { colors } = useTheme();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [records, setRecords] = useState<FuelRecord[]>([]);
  const [stats, setStats] = useState<FuelStats | null>(null);
  const [loading, setLoading] = useState(true);

  // modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mDate, setMDate] = useState('');
  const [mLiters, setMLiters] = useState('');
  const [mKm, setMKm] = useState('');
  const [mPrice, setMPrice] = useState('');
  const [mLoading, setMLoading] = useState(false);
  const [mIsFull, setMIsFull] = useState(true);
  const [mStation, setMStation] = useState('');
  const [mPump, setMPump] = useState('');
  const [mAccountId, setMAccountId] = useState<string | null>(null);
  const [mAccountPickerOpen, setMAccountPickerOpen] = useState(false);
  const { accounts: fAccounts } = useFinancialAccounts();

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const [recs, stts] = await Promise.all([
        getFuelRecords(vehicleId),
        computeFuelStats(vehicleId),
      ]);
      setRecords(recs);
      setStats(stts);
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

  // Cel mai recent km înregistrat (după dată DESC, primul cu km_total).
  const lastKm = records.find(r => r.km_total !== undefined)?.km_total;

  function openModal() {
    setEditingId(null);
    setMDate(todayIso());
    setMLiters('');
    setMKm('');
    setMPrice('');
    setMIsFull(true);
    setMStation('');
    setMPump('');
    setMAccountId(null);
    setMAccountPickerOpen(false);
    setModalVisible(true);
  }

  function openEditModal(record: FuelRecord) {
    setEditingId(record.id);
    setMDate(record.date);
    setMLiters(record.liters !== undefined ? String(record.liters) : '');
    setMKm(record.km_total !== undefined ? String(record.km_total) : '');
    setMPrice(record.price !== undefined ? String(record.price) : '');
    setMIsFull(record.is_full);
    setMStation(record.station ?? '');
    setMPump(record.pump_number ?? '');
    setMAccountId(record.account_id ?? null);
    setMAccountPickerOpen(false);
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
      if (!info.liters && !info.km && !info.price && !info.date && !info.station) {
        Alert.alert('OCR', 'Nu s-au putut extrage date din bon. Completează manual.');
      } else {
        if (info.date) setMDate(info.date);
        if (info.liters !== undefined) setMLiters(String(info.liters));
        if (info.km !== undefined) setMKm(String(info.km));
        if (info.price !== undefined) setMPrice(String(info.price));
        if (info.station) setMStation(info.station);
      }
    } catch {
      Alert.alert('Eroare OCR', 'Nu s-a putut citi bonul. Completează manual.');
    } finally {
      setMLoading(false);
    }
  }

  async function persistRecord(
    date: string,
    liters?: number,
    km?: number,
    price?: number,
    station?: string,
    pump?: string,
    accountId?: string | null
  ) {
    if (!vehicleId) return;
    setMLoading(true);
    try {
      if (editingId) {
        await updateFuelRecord(editingId, {
          date,
          liters,
          km_total: km,
          price,
          is_full: mIsFull,
          station,
          pump_number: pump,
          account_id: accountId ?? null,
        });
      } else {
        await addFuelRecord(vehicleId, {
          date,
          liters,
          km_total: km,
          price,
          is_full: mIsFull,
          station,
          pump_number: pump,
          account_id: accountId ?? undefined,
        });
      }
      setModalVisible(false);
      setEditingId(null);
      await load();
    } catch {
      Alert.alert('Eroare', 'Nu s-a putut salva înregistrarea.');
    } finally {
      setMLoading(false);
    }
  }

  async function handleSaveRecord() {
    if (!vehicleId) return;
    const date = mDate.trim();
    if (!date) {
      Alert.alert('Eroare', 'Data este obligatorie.');
      return;
    }
    const liters = mLiters.trim() ? parseFloat(mLiters.replace(',', '.')) : undefined;
    const km = mKm.trim() ? parseInt(mKm, 10) : undefined;
    const price = mPrice.trim() ? parseFloat(mPrice.replace(',', '.')) : undefined;
    const station = mStation.trim() || undefined;
    const pump = mPump.trim() || undefined;
    const accountId = mAccountId;

    // Validare ordine cronologică: km trebuie să fie monoton crescător
    // raportat la vecinii sortați după dată (excluzând bonul editat).
    if (km !== undefined) {
      const others = records
        .filter(r => r.id !== editingId && r.km_total !== undefined)
        .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
      const prev = [...others].reverse().find(r => r.date <= date);
      const next = others.find(r => r.date > date);

      const issues: string[] = [];
      if (prev && prev.km_total !== undefined && km <= prev.km_total) {
        issues.push(`• bonul din ${prev.date} are ${prev.km_total.toLocaleString('ro-RO')} km`);
      }
      if (next && next.km_total !== undefined && km >= next.km_total) {
        issues.push(`• bonul din ${next.date} are ${next.km_total.toLocaleString('ro-RO')} km`);
      }

      if (issues.length > 0) {
        Alert.alert(
          'KM neobișnuit',
          `KM-ul ${km.toLocaleString('ro-RO')} nu respectă ordinea cronologică:\n\n${issues.join('\n')}\n\nSalvezi oricum? Consumul mediu va fi recalculat.`,
          [
            { text: 'Anulează', style: 'cancel' },
            {
              text: 'Salvează oricum',
              onPress: () => persistRecord(date, liters, km, price, station, pump, accountId),
            },
          ]
        );
        return;
      }
    }

    await persistRecord(date, liters, km, price, station, pump, accountId);
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
        <>
          <View style={styles.statsBar}>
            <View style={[styles.statCard, { backgroundColor: palette.card }]}>
              <Text
                style={styles.statValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {stats.totalRecords}
              </Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>înreg.</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: palette.card }]}>
              <Text
                style={styles.statValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {stats.totalLiters.toFixed(1)}
              </Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>L total</Text>
            </View>
            <View style={[styles.statCard, { backgroundColor: palette.card }]}>
              <Text
                style={styles.statValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.6}
              >
                {stats.totalCost.toFixed(2)}
              </Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>RON</Text>
            </View>
          </View>
          <FuelConsumptionChart
            values={stats.consumptionSparkline}
            averageL100={stats.avgConsumptionL100}
            cardColor={palette.card}
            textSecondary={palette.textSecondary}
          />
          <Pressable
            onPress={() =>
              router.push(
                `/(tabs)/entitati/fuel-stats?vehicleId=${vehicleId}&vehicleName=${encodeURIComponent(vehicleName ?? '')}`
              )
            }
            style={({ pressed }) => [styles.statsLink, pressed && styles.btnPressed]}
          >
            <Text style={[styles.statsLinkText, { color: primary }]}>
              Vezi statistici detaliate →
            </Text>
          </Pressable>
        </>
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Lista înregistrări */}
        <Text style={styles.sectionTitle}>Istoric bonuri</Text>

        {loading && <ActivityIndicator color={primary} style={{ marginVertical: 20 }} />}

        {!loading && records.length === 0 && (
          <Text style={styles.empty}>Nicio înregistrare. Adaugă primul bon.</Text>
        )}

        {records.map((record, i) => {
          // records sortate DESC după dată → "anteriorul" chronologic e records[i+1]
          const prev = i + 1 < records.length ? records[i + 1] : null;
          let kmSinceLast: number | undefined;
          if (prev && record.km_total !== undefined && prev.km_total !== undefined) {
            const delta = record.km_total - prev.km_total;
            if (delta > 0) kmSinceLast = delta;
          }

          // Consum mediu: doar la bonurile pline. Adună litrii din toate bonurile
          // (parțiale + acest plin) de la ultimul plin anterior și împarte la km parcurși.
          let consumptionSinceLast: number | undefined;
          if (record.is_full && record.km_total !== undefined) {
            let prevFullIdx = -1;
            for (let j = i + 1; j < records.length; j++) {
              if (records[j].is_full && records[j].km_total !== undefined) {
                prevFullIdx = j;
                break;
              }
            }
            if (prevFullIdx !== -1) {
              const prevFull = records[prevFullIdx];
              const kmDelta = record.km_total - (prevFull.km_total ?? 0);
              let totalLiters = 0;
              for (let j = i; j < prevFullIdx; j++) {
                totalLiters += records[j].liters ?? 0;
              }
              if (kmDelta > 0 && totalLiters > 0) {
                consumptionSinceLast = (totalLiters / kmDelta) * 100;
              }
            }
          }

          return (
            <Pressable
              key={record.id}
              style={({ pressed }) => [
                styles.recordCard,
                { backgroundColor: colors.card },
                pressed && styles.btnPressed,
              ]}
              onPress={() => openEditModal(record)}
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
                  <Text style={styles.recordMeta}>
                    {record.km_total.toLocaleString('ro-RO')} km
                  </Text>
                )}
              </View>
              {record.station && (
                <Text style={[styles.recordStation, { color: palette.textSecondary }]}>
                  📍 {record.station}
                </Text>
              )}
              {prev && (
                <Text style={[styles.recordSinceLast, { color: palette.textSecondary }]}>
                  De la ultima:{' '}
                  {kmSinceLast !== undefined ? `${kmSinceLast.toLocaleString('ro-RO')} km` : '– km'}{' '}
                  ·{' '}
                  {consumptionSinceLast !== undefined
                    ? `${consumptionSinceLast.toFixed(1)} L/100km`
                    : '– L/100km'}
                </Text>
              )}
              <Text style={styles.recordHint}>Apasă pentru editare · lung pentru ștergere</Text>
            </Pressable>
          );
        })}
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
          <View style={[styles.modalContent, { backgroundColor: palette.card }]}>
            <Text style={styles.modalTitle}>{editingId ? 'Editează bon' : 'Bon alimentare'}</Text>

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

            <DatePickerField label="Data" value={mDate} onChange={setMDate} disabled={mLoading} />

            <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>Benzinărie</Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  borderColor: palette.border,
                  color: colors.text,
                  backgroundColor: palette.background,
                },
              ]}
              value={mStation}
              onChangeText={setMStation}
              placeholder="Ex: OMV Cluj-Napoca, Calea Turzii"
              placeholderTextColor={palette.textSecondary}
              editable={!mLoading}
            />

            <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>Nr. pompă</Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  borderColor: palette.border,
                  color: colors.text,
                  backgroundColor: palette.background,
                },
              ]}
              value={mPump}
              onChangeText={setMPump}
              placeholder="Ex: 4"
              placeholderTextColor={palette.textSecondary}
              keyboardType="default"
              editable={!mLoading}
            />

            <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>Litri</Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  borderColor: palette.border,
                  color: colors.text,
                  backgroundColor: palette.background,
                },
              ]}
              value={mLiters}
              onChangeText={setMLiters}
              placeholder="Ex: 45.23"
              placeholderTextColor={palette.textSecondary}
              keyboardType="decimal-pad"
              editable={!mLoading}
            />

            <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>
              KM total (odometru)
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  borderColor: palette.border,
                  color: colors.text,
                  backgroundColor: palette.background,
                },
              ]}
              value={mKm}
              onChangeText={setMKm}
              placeholder={
                lastKm !== undefined ? `Anterior: ${lastKm.toLocaleString('ro-RO')}` : 'Ex: 125430'
              }
              placeholderTextColor={palette.textSecondary}
              keyboardType="number-pad"
              editable={!mLoading}
            />

            <View style={styles.isFullRow}>
              <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>
                Plin complet
              </Text>
              <Switch
                value={mIsFull}
                onValueChange={setMIsFull}
                trackColor={{ false: palette.border, true: primary }}
                disabled={mLoading}
              />
            </View>
            {!mIsFull && (
              <Text style={[styles.isFullHint, { color: palette.textSecondary }]}>
                Litrii nu vor fi contați în consum până la următorul plin complet.
              </Text>
            )}

            <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>
              Preț total (RON)
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                {
                  borderColor: palette.border,
                  color: colors.text,
                  backgroundColor: palette.background,
                },
              ]}
              value={mPrice}
              onChangeText={setMPrice}
              placeholder="Ex: 280.50"
              placeholderTextColor={palette.textSecondary}
              keyboardType="decimal-pad"
              editable={!mLoading}
            />

            {fAccounts.length > 0 && (
              <>
                <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>
                  Cont plată
                </Text>
                <Pressable
                  style={[
                    styles.modalInput,
                    {
                      borderColor: palette.border,
                      backgroundColor: palette.background,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    },
                  ]}
                  onPress={() => setMAccountPickerOpen(v => !v)}
                  disabled={mLoading}
                >
                  <Text style={{ color: colors.text, fontSize: 15 }}>
                    {mAccountId
                      ? fAccounts.find(a => a.id === mAccountId)?.name ?? 'Cont necunoscut'
                      : 'Fără cont'}
                  </Text>
                  <Ionicons
                    name={mAccountPickerOpen ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={palette.textSecondary}
                  />
                </Pressable>
                {mAccountPickerOpen && (
                  <View
                    style={[
                      styles.pickerList,
                      { borderColor: palette.border, backgroundColor: palette.background },
                    ]}
                  >
                    <Pressable
                      style={styles.pickerItem}
                      onPress={() => {
                        setMAccountId(null);
                        setMAccountPickerOpen(false);
                      }}
                    >
                      <Text style={{ color: colors.text }}>Fără cont</Text>
                    </Pressable>
                    {fAccounts.map(a => (
                      <Pressable
                        key={a.id}
                        style={[styles.pickerItem, { borderTopColor: palette.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                        onPress={() => {
                          setMAccountId(a.id);
                          setMAccountPickerOpen(false);
                        }}
                      >
                        <Text style={{ color: colors.text }}>
                          {a.name} ({a.currency})
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}

            <View style={styles.modalButtons}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalCancelBtn,
                  { borderColor: palette.border },
                  pressed && styles.btnPressed,
                ]}
                onPress={() => setModalVisible(false)}
                disabled={mLoading}
              >
                <Text style={[styles.modalCancelText, { color: palette.textSecondary }]}>
                  Anulare
                </Text>
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
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  statValue: { fontSize: 15, fontWeight: '700', color: primary },
  statLabel: { fontSize: 11, marginTop: 2, textAlign: 'center' },

  statsLink: {
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  statsLinkText: { fontSize: 13, fontWeight: '600' },

  scroll: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 90 },

  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 14 },

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
  recordStation: { fontSize: 12, marginTop: 4 },
  recordSinceLast: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  recordHint: { fontSize: 11, opacity: 0.35, marginTop: 4 },

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
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  modalLabel: { fontSize: 13, marginBottom: 5 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
    marginBottom: 14,
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
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 15 },
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
    marginBottom: 14,
  },
  pickerList: {
    borderWidth: 1,
    borderRadius: 10,
    marginTop: -8,
    marginBottom: 14,
    maxHeight: 220,
  },
  pickerItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
});
