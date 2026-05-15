import { useCallback, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput,
  Switch,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, useRouter } from 'expo-router';
import { useTheme } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Text, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { primary, light, dark, statusColors } from '@/theme/colors';
import { DatePickerField } from '@/components/DatePickerField';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { FuelStatsBar } from '@/components/fuel/FuelStatsBar';
import { FuelRecordCard } from '@/components/fuel/FuelRecordCard';
import {
  getFuelRecords,
  addFuelRecord,
  updateFuelRecord,
  deleteFuelRecord,
  computeFuelStats,
} from '@/services/fuel';
import { extractText, extractFuelInfo } from '@/services/ocr';
import { extractTextFromPdf } from '@/services/pdfExtractor';
import { renderPdfFirstPageForVision } from '@/services/pdfOcr';
import { mapFuelReceiptWithAi, mergeFuelResults, type FuelAiResult } from '@/services/aiOcrMapper';
import * as FileSystem from 'expo-file-system/legacy';
import type { FuelRecord, FuelStats } from '@/services/fuel';

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
  const [mPriceL, setMPriceL] = useState('');
  const [mLoading, setMLoading] = useState(false);
  const [mIsFull, setMIsFull] = useState(true);
  const [mStation, setMStation] = useState('');
  const [mPump, setMPump] = useState('');

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
    setMPriceL('');
    setMIsFull(true);
    setMStation('');
    setMPump('');
    setModalVisible(true);
  }

  function openEditModal(record: FuelRecord) {
    setEditingId(record.id);
    setMDate(record.date);
    setMLiters(record.liters !== undefined ? String(record.liters) : '');
    setMKm(record.km_total !== undefined ? String(record.km_total) : '');
    setMPrice(record.price !== undefined ? String(record.price) : '');
    // Derivăm priceL la editare ca să avem afișat prețul/litru pentru un bon vechi.
    if (record.liters !== undefined && record.price !== undefined && record.liters > 0) {
      setMPriceL((record.price / record.liters).toFixed(2));
    } else {
      setMPriceL('');
    }
    setMIsFull(record.is_full);
    setMStation(record.station ?? '');
    setMPump(record.pump_number ?? '');
    setModalVisible(true);
  }

  async function processReceiptOcr(ocrText: string, imageBase64?: string) {
    if (!ocrText.trim() && !imageBase64) {
      Alert.alert('Eroare OCR', 'Nu s-au extras date din bon. Completează manual.');
      return;
    }

    let aiResult: FuelAiResult = {};
    try {
      aiResult = await mapFuelReceiptWithAi(ocrText, imageBase64);
    } catch (err) {
      console.warn('[fuel-ai] failed:', err instanceof Error ? err.message : 'unknown error');
    }

    const regexResult = extractFuelInfo(ocrText);
    const final = mergeFuelResults(aiResult, regexResult);

    if (
      final.liters === undefined &&
      final.km === undefined &&
      final.price === undefined &&
      final.date === undefined &&
      final.station === undefined
    ) {
      Alert.alert('OCR', 'Nu s-au putut extrage date din bon. Completează manual.');
      return;
    }

    if (final.date) setMDate(final.date);
    if (final.liters !== undefined) setMLiters(String(final.liters));
    if (final.km !== undefined) setMKm(String(final.km));
    if (final.price !== undefined) setMPrice(String(final.price));
    if (final.station) setMStation(final.station);
    if (final.pump !== undefined) setMPump(String(final.pump));
    // priceL: dacă OCR-ul l-a extras direct (X-pattern MOL), folosim valoarea exactă;
    // altfel îl derivăm din liters/price ca să avem ceva afișat în câmp.
    if (final.priceL !== undefined) {
      setMPriceL(String(final.priceL));
    } else if (final.liters !== undefined && final.price !== undefined && final.liters > 0) {
      setMPriceL((final.price / final.liters).toFixed(2));
    }
  }

  // ─── Bidirectional sync pentru liters × priceL = price ──────────────────────
  // Anchor: liters. Editarea oricărui câmp recalculează unul dintre celelalte:
  // - liters → recompute price (priceL anchored)
  // - priceL → recompute price (liters anchored)
  // - price  → recompute priceL (liters anchored)
  // Folosit doar la input MANUAL al utilizatorului (NU la auto-fill din OCR).

  function handleLitersChange(text: string) {
    setMLiters(text);
    const liters = parseFloat(text.replace(',', '.'));
    const priceL = parseFloat(mPriceL.replace(',', '.'));
    if (!isNaN(liters) && liters > 0 && !isNaN(priceL) && priceL > 0) {
      setMPrice((liters * priceL).toFixed(2));
    }
  }

  function handlePriceLChange(text: string) {
    setMPriceL(text);
    const priceL = parseFloat(text.replace(',', '.'));
    const liters = parseFloat(mLiters.replace(',', '.'));
    if (!isNaN(priceL) && priceL > 0 && !isNaN(liters) && liters > 0) {
      setMPrice((liters * priceL).toFixed(2));
    }
  }

  function handlePriceChange(text: string) {
    setMPrice(text);
    const price = parseFloat(text.replace(',', '.'));
    const liters = parseFloat(mLiters.replace(',', '.'));
    if (!isNaN(price) && price > 0 && !isNaN(liters) && liters > 0) {
      setMPriceL((price / liters).toFixed(2));
    }
  }

  // ─── Math check pentru afișaj eroare ────────────────────────────────────────
  // Toleranță 1% pentru rounding (priceL afișat cu 2 zecimale poate diverge ușor).
  const litersN = parseFloat(mLiters.replace(',', '.'));
  const priceLN = parseFloat(mPriceL.replace(',', '.'));
  const priceN = parseFloat(mPrice.replace(',', '.'));
  const mathCheckable =
    !isNaN(litersN) &&
    litersN > 0 &&
    !isNaN(priceLN) &&
    priceLN > 0 &&
    !isNaN(priceN) &&
    priceN > 0;
  const expectedPrice = mathCheckable ? litersN * priceLN : 0;
  const hasMathError = mathCheckable && Math.abs(expectedPrice - priceN) / priceN > 0.01;
  const errorBorderColor = hasMathError ? statusColors.critical : palette.border;

  async function processReceiptAsset(asset: ImagePicker.ImagePickerAsset) {
    const uri = asset.uri;
    setMLoading(true);
    try {
      let ocrText = '';
      try {
        const ocr = await extractText(uri);
        ocrText = ocr.text;
      } catch {
        Alert.alert('Eroare OCR', 'Nu s-a putut citi bonul. Completează manual.');
        return;
      }

      let base64: string | undefined;
      try {
        base64 =
          asset.base64 ??
          (await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          }));
      } catch (err) {
        console.warn('[fuel] base64 read failed:', err);
      }

      await processReceiptOcr(ocrText, base64);
    } finally {
      setMLoading(false);
    }
  }

  async function processReceiptPdf(uri: string) {
    setMLoading(true);
    try {
      let ocrText = '';
      try {
        ocrText = (await extractTextFromPdf(uri)).trim();
      } catch (err) {
        console.warn('[fuel-pdf] extractTextFromPdf failed:', err);
      }

      let base64: string | undefined;
      try {
        const rendered = await renderPdfFirstPageForVision(uri);
        base64 = rendered ?? undefined;
      } catch (err) {
        console.warn('[fuel-pdf] renderPdfFirstPageForVision failed:', err);
      }

      if (!ocrText && !base64) {
        Alert.alert('Eroare PDF', 'Nu s-a putut citi PDF-ul. Completează manual.');
        return;
      }

      await processReceiptOcr(ocrText, base64);
    } finally {
      setMLoading(false);
    }
  }

  async function handleScanFromCamera() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisiune refuzată', 'Aplicația nu are acces la cameră.');
      return;
    }
    // allowsEditing=false: păstrăm imaginea originală 4:3 a iPhone-ului fără
    // crop forțat — bonurile lungi nu încap în 1:1 sau 4:3 portrait.
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.9,
      base64: true,
      exif: true,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    await processReceiptAsset(result.assets[0]);
  }

  async function handleScanFromGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisiune refuzată', 'Aplicația nu are acces la galeria foto.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.9,
      base64: true,
      exif: true,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    await processReceiptAsset(result.assets[0]);
  }

  async function handleScanFromPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;
      await processReceiptPdf(asset.uri);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut selecta PDF-ul');
    }
  }

  function handleScanReceipt() {
    Alert.alert('Scanează bon', 'Alege sursa', [
      { text: 'Cameră', onPress: handleScanFromCamera },
      { text: 'Galerie', onPress: handleScanFromGallery },
      { text: 'PDF', onPress: handleScanFromPdf },
      { text: 'Anulează', style: 'cancel' },
    ]);
  }

  async function persistRecord(
    date: string,
    liters?: number,
    km?: number,
    price?: number,
    station?: string,
    pump?: string
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
              onPress: () => persistRecord(date, liters, km, price, station, pump),
            },
          ]
        );
        return;
      }
    }

    await persistRecord(date, liters, km, price, station, pump);
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
      {stats && (
        <FuelStatsBar
          stats={stats}
          scheme={scheme}
          onOpenDetails={() =>
            router.push(
              `/(tabs)/entitati/fuel-stats?vehicleId=${vehicleId}&vehicleName=${encodeURIComponent(vehicleName ?? '')}`
            )
          }
        />
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

        {records.map((record, i) => (
          <FuelRecordCard
            key={record.id}
            record={record}
            index={i}
            records={records}
            scheme={scheme}
            cardColor={colors.card}
            onPress={() => openEditModal(record)}
            onLongPress={() => handleDeleteRecord(record)}
          />
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
      <FormSheetModal
        visible={modalVisible}
        title={editingId ? 'Editează bon' : 'Bon alimentare'}
        onClose={() => setModalVisible(false)}
        onSave={handleSaveRecord}
        saving={mLoading}
      >
        {/* OCR */}
        <Pressable
          style={({ pressed }) => [styles.ocrBtn, styles.ocrBtnFull, pressed && styles.btnPressed]}
          onPress={handleScanReceipt}
          disabled={mLoading}
        >
          <Text style={styles.ocrBtnText} numberOfLines={1}>
            {mLoading ? 'Se analizează bonul...' : '📷 Scanează bon'}
          </Text>
        </Pressable>

        <DatePickerField label="Data" value={mDate} onChange={setMDate} disabled={mLoading} />

        <View>
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
        </View>

        <View>
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
        </View>

        <View>
          <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>Litri</Text>
          <TextInput
            style={[
              styles.modalInput,
              {
                borderColor: errorBorderColor,
                color: colors.text,
                backgroundColor: palette.background,
              },
            ]}
            value={mLiters}
            onChangeText={handleLitersChange}
            placeholder="Ex: 45.23"
            placeholderTextColor={palette.textSecondary}
            keyboardType="decimal-pad"
            editable={!mLoading}
          />
        </View>

        <View>
          <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>
            Preț/litru (RON)
          </Text>
          <TextInput
            style={[
              styles.modalInput,
              {
                borderColor: errorBorderColor,
                color: colors.text,
                backgroundColor: palette.background,
              },
            ]}
            value={mPriceL}
            onChangeText={handlePriceLChange}
            placeholder="Ex: 9.82"
            placeholderTextColor={palette.textSecondary}
            keyboardType="decimal-pad"
            editable={!mLoading}
          />
        </View>

        <View>
          <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>
            Preț total (RON)
          </Text>
          <TextInput
            style={[
              styles.modalInput,
              {
                borderColor: errorBorderColor,
                color: colors.text,
                backgroundColor: palette.background,
              },
            ]}
            value={mPrice}
            onChangeText={handlePriceChange}
            placeholder="Ex: 280.50"
            placeholderTextColor={palette.textSecondary}
            keyboardType="decimal-pad"
            editable={!mLoading}
          />
        </View>

        {hasMathError && (
          <View
            style={[
              styles.mathWarning,
              {
                borderColor: statusColors.critical,
                backgroundColor: `${statusColors.critical}14`,
              },
            ]}
          >
            <Text style={[styles.mathWarningTitle, { color: statusColors.critical }]}>
              ⚠ Verifică valorile
            </Text>
            <Text style={[styles.mathWarningBody, { color: colors.text }]}>
              {`${litersN.toFixed(2)} L × ${priceLN.toFixed(2)} RON/L = ${expectedPrice.toFixed(2)} RON, dar totalul e ${priceN.toFixed(2)} RON. Probabil OCR-ul a citit greșit un câmp.`}
            </Text>
          </View>
        )}

        <View>
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
        </View>

        <View style={styles.isFullRow}>
          <Text style={[styles.modalLabel, { color: palette.textSecondary }]}>Plin complet</Text>
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
      </FormSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 16, opacity: 0.7, textAlign: 'center' },

  scroll: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 90 },

  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 14 },
  empty: { opacity: 0.6, fontSize: 14, marginBottom: 16, textAlign: 'center' },

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
  },
  ocrBtnFull: {
    marginBottom: 18,
  },
  ocrBtnText: { color: primary, fontSize: 15, fontWeight: '600' },
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
  mathWarning: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  mathWarningTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4,
  },
  mathWarningBody: {
    fontSize: 12,
    lineHeight: 17,
  },
});
