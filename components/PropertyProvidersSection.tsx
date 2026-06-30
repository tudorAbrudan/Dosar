import { useCallback, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from 'expo-router';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import {
  getServiceProviders,
  addServiceProvider,
  updateServiceProvider,
  deleteServiceProvider,
} from '@/services/serviceProviders';
import { extractText } from '@/services/ocr';
import { mapUtilityInvoiceWithAi } from '@/services/aiOcrMapper';
import { scanDocumentPages } from '@/services/documentScanner';
import { ALL_UTILITY_TYPES, UTILITY_TYPE_LABELS, UTILITY_TYPE_EMOJI } from '@/types';
import type { ServiceProvider, UtilityType } from '@/types';

type Props = {
  propertyId: string;
};

const DEFAULT_TYPE: UtilityType = 'curent';

function emptyForm() {
  return {
    type: DEFAULT_TYPE as UtilityType,
    providerName: '',
    customerCode: '',
    podCode: '',
    supportPhone: '',
  };
}

export function PropertyProvidersSection({ propertyId }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const [providers, setProviders] = useState<ServiceProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // modal state
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  // form fields
  const [type, setType] = useState<UtilityType>(DEFAULT_TYPE);
  const [providerName, setProviderName] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [podCode, setPodCode] = useState('');
  const [supportPhone, setSupportPhone] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getServiceProviders(propertyId);
      setProviders(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  }, [propertyId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  // ─── Scan flow ────────────────────────────────────────────────────────────

  async function processInvoiceUri(uri: string, base64?: string) {
    setScanning(true);
    try {
      const ocr = await extractText(uri);
      const result = await mapUtilityInvoiceWithAi(ocr.text, base64);
      if (result.type) setType(result.type);
      if (result.providerName) setProviderName(result.providerName);
      if (result.customerCode) setCustomerCode(result.customerCode);
      if (result.consumptionPointCode) setPodCode(result.consumptionPointCode);
      if (result.supportPhone) setSupportPhone(result.supportPhone);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut citi factura.');
    } finally {
      setScanning(false);
    }
  }

  async function scanFromCamera() {
    try {
      const uris = await scanDocumentPages();
      if (!uris || uris.length === 0) return;
      await processInvoiceUri(uris[0]);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Scanarea a eșuat.');
    }
  }

  async function scanFromGallery() {
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
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];
    await processInvoiceUri(asset.uri, asset.base64 ?? undefined);
  }

  function handleScanInvoice() {
    Alert.alert('Scanează factură', 'Alege sursa', [
      { text: 'Scaner', onPress: scanFromCamera },
      { text: 'Galerie', onPress: scanFromGallery },
      { text: 'Anulează', style: 'cancel' },
    ]);
  }

  // ─── Modal helpers ─────────────────────────────────────────────────────────

  function openAddModal() {
    const f = emptyForm();
    setEditingId(null);
    setType(f.type);
    setProviderName(f.providerName);
    setCustomerCode(f.customerCode);
    setPodCode(f.podCode);
    setSupportPhone(f.supportPhone);
    setModalVisible(true);
  }

  function openEditModal(p: ServiceProvider) {
    setEditingId(p.id);
    setType(p.type);
    setProviderName(p.provider_name ?? '');
    setCustomerCode(p.customer_code ?? '');
    setPodCode(p.consumption_point_code ?? '');
    setSupportPhone(p.support_phone ?? '');
    setModalVisible(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const input = {
        type,
        provider_name: providerName.trim() || undefined,
        customer_code: customerCode.trim() || undefined,
        consumption_point_code: podCode.trim() || undefined,
        support_phone: supportPhone.trim() || undefined,
      };
      if (editingId) {
        await updateServiceProvider(editingId, input);
      } else {
        await addServiceProvider(propertyId, input);
      }
      setModalVisible(false);
      await refresh();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva furnizorul.');
    } finally {
      setSaving(false);
    }
  }

  function handleLongPress(p: ServiceProvider) {
    const label = p.provider_name ?? UTILITY_TYPE_LABELS[p.type];
    Alert.alert('Șterge furnizor', `Ștergi „${label}"?`, [
      { text: 'Anulează', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteServiceProvider(p.id);
            await refresh();
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge.');
          }
        },
      },
    ]);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <View style={styles.headerRow}>
        <Text style={[styles.sectionTitle, { color: C.textSecondary }]}>FURNIZORI UTILITĂȚI</Text>
      </View>

      {loading && <ActivityIndicator color={primary} style={styles.loader} />}

      {!loading && error !== null && (
        <Text style={[styles.errorText, { color: C.textSecondary }]}>{error}</Text>
      )}

      {!loading && providers.length === 0 && error === null && (
        <Text style={[styles.emptyText, { color: C.textSecondary }]}>Niciun furnizor adăugat.</Text>
      )}

      {providers.map(p => (
        <Pressable
          key={p.id}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: C.card, shadowColor: C.cardShadow },
            pressed && styles.cardPressed,
          ]}
          onPress={() => openEditModal(p)}
          onLongPress={() => handleLongPress(p)}
        >
          <View style={styles.cardMain}>
            <View style={styles.cardLeft}>
              <Text style={styles.emoji}>{UTILITY_TYPE_EMOJI[p.type]}</Text>
              <View style={styles.cardText}>
                <Text style={[styles.cardTitle, { color: C.text }]} numberOfLines={1}>
                  {p.provider_name ?? UTILITY_TYPE_LABELS[p.type]}
                </Text>
                {p.customer_code || p.consumption_point_code ? (
                  <Text style={[styles.cardSub, { color: C.textSecondary }]} numberOfLines={1}>
                    {[p.customer_code, p.consumption_point_code].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
            </View>
            {p.support_phone ? (
              <Pressable
                style={({ pressed }) => [styles.phoneBtn, pressed && styles.phoneBtnPressed]}
                onPress={() => Linking.openURL(`tel:${p.support_phone}`)}
                hitSlop={8}
              >
                <Text style={[styles.phoneIcon, { color: primary }]}>📞</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      ))}

      <Pressable
        style={({ pressed }) => [
          styles.addBtn,
          { borderColor: primary },
          pressed && styles.addBtnPressed,
        ]}
        onPress={openAddModal}
      >
        <Text style={[styles.addBtnText, { color: primary }]}>+ Adaugă furnizor</Text>
      </Pressable>

      <FormSheetModal
        visible={modalVisible}
        title={editingId ? 'Editează furnizor' : 'Adaugă furnizor'}
        onClose={() => setModalVisible(false)}
        onSave={handleSave}
        saving={saving}
      >
        {/* Scanează factură */}
        <Pressable
          style={({ pressed }) => [styles.scanBtn, pressed && styles.scanBtnPressed]}
          onPress={handleScanInvoice}
          disabled={scanning}
        >
          <Text style={[styles.scanBtnText, { color: primary }]}>
            {scanning ? 'Se analizează factura...' : '📷 Scanează factură'}
          </Text>
        </Pressable>

        {/* Tip utilitate — chips */}
        <View>
          <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>Tip utilitate</Text>
          <View style={styles.chipsRow}>
            {ALL_UTILITY_TYPES.map(t => {
              const active = type === t;
              return (
                <Pressable
                  key={t}
                  style={[
                    styles.chip,
                    active
                      ? { backgroundColor: primary }
                      : { backgroundColor: C.card, borderColor: C.border, borderWidth: 1 },
                  ]}
                  onPress={() => setType(t)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
                      { color: active ? '#fff' : C.text },
                    ]}
                  >
                    {UTILITY_TYPE_EMOJI[t]} {UTILITY_TYPE_LABELS[t]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Câmpuri text */}
        <View>
          <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>Furnizor</Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: C.border, color: C.text, backgroundColor: C.background },
            ]}
            value={providerName}
            onChangeText={setProviderName}
            placeholder="Ex: E.ON, Engie, PPC, Digi"
            placeholderTextColor={C.textSecondary}
            editable={!saving}
          />
        </View>

        <View>
          <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>Cod client</Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: C.border, color: C.text, backgroundColor: C.background },
            ]}
            value={customerCode}
            onChangeText={setCustomerCode}
            placeholder="Codul de client / cod de încasare"
            placeholderTextColor={C.textSecondary}
            editable={!saving}
          />
        </View>

        <View>
          <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>
            Cod loc de consum (POD/CLC)
          </Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: C.border, color: C.text, backgroundColor: C.background },
            ]}
            value={podCode}
            onChangeText={setPodCode}
            placeholder="Ex: RO12345678 sau CLC123"
            placeholderTextColor={C.textSecondary}
            editable={!saving}
          />
        </View>

        <View>
          <Text style={[styles.fieldLabel, { color: C.textSecondary }]}>Telefon suport</Text>
          <TextInput
            style={[
              styles.input,
              { borderColor: C.border, color: C.text, backgroundColor: C.background },
            ]}
            value={supportPhone}
            onChangeText={setSupportPhone}
            placeholder="Ex: 0800 123 456"
            placeholderTextColor={C.textSecondary}
            keyboardType="phone-pad"
            editable={!saving}
          />
        </View>
      </FormSheetModal>
    </>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    marginTop: 20,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
  },
  loader: { marginVertical: 12 },
  errorText: { fontSize: 13, marginBottom: 8 },
  emptyText: { fontSize: 13, marginBottom: 8, opacity: 0.7 },

  // Provider card
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  cardPressed: { opacity: 0.8 },
  cardMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  emoji: { fontSize: 22, marginRight: 12 },
  cardText: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  cardSub: { fontSize: 12, marginTop: 2 },

  phoneBtn: { padding: 4 },
  phoneBtnPressed: { opacity: 0.6 },
  phoneIcon: { fontSize: 18 },

  // Add button
  addBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  addBtnPressed: { opacity: 0.7 },
  addBtnText: { fontSize: 15, fontWeight: '600' },

  // Scan button
  scanBtn: {
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  scanBtnPressed: { opacity: 0.7 },
  scanBtnText: { fontSize: 15, fontWeight: '600' },

  // Chips
  fieldLabel: { fontSize: 13, marginBottom: 6 },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  chipText: { fontSize: 13, fontWeight: '500' },

  // Input
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 15,
  },
});
