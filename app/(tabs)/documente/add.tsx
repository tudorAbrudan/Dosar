import { useState } from 'react';
import {
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Switch,
  View as RNView,
  Text as RNText,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { useDocuments } from '@/hooks/useDocuments';
import { useEntities } from '@/hooks/useEntities';
import { scheduleExpirationReminders } from '@/services/notifications';
import { addExpiryCalendarEvent, isCalendarAvailable } from '@/services/calendar';
import { extractText, extractDocumentInfo, extractInvoiceInfo, extractPlateNumber, extractFuelInfo } from '@/services/ocr';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType, EntityType } from '@/types';
import { DOCUMENT_FIELDS } from '@/types/documentFields';
import type { FieldDef } from '@/types/documentFields';
import { useCustomTypes } from '@/hooks/useCustomTypes';

const STANDARD_TYPES = Object.entries(DOCUMENT_TYPE_LABELS)
  .filter(([value]) => value !== 'custom')
  .map(([value, label]) => ({ value: value as DocumentType, label }));

const ENTITY_CATEGORIES: { key: EntityType; label: string }[] = [
  { key: 'person', label: 'Persoană' },
  { key: 'property', label: 'Proprietate' },
  { key: 'vehicle', label: 'Vehicul' },
  { key: 'card', label: 'Card' },
  { key: 'animal', label: 'Animal' },
];

async function applyDocumentScan(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], {
    compress: 0.9,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: false,
  });
  return result.uri;
}

export default function AddDocumentScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const params = useLocalSearchParams<{
    person_id?: string;
    property_id?: string;
    vehicle_id?: string;
    card_id?: string;
    animal_id?: string;
  }>();
  const { createDocument, refresh } = useDocuments();
  const { persons, properties, vehicles, cards, animals } = useEntities();
  const { customTypes } = useCustomTypes();

  const [type, setType] = useState<DocumentType>('buletin');
  const [customTypeId, setCustomTypeId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [fullTank, setFullTank] = useState(true);
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [note, setNote] = useState('');
  const [pages, setPages] = useState<{ uri: string; localPath: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  // Entity picker state (only used when screen opened without params)
  const [pickerCategory, setPickerCategory] = useState<EntityType>('person');
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedAnimalId, setSelectedAnimalId] = useState<string | null>(null);

  const personId = params.person_id;
  const propertyId = params.property_id;
  const vehicleId = params.vehicle_id;
  const cardId = params.card_id;
  const animalId = params.animal_id;
  const hasParamLink = !!(personId || propertyId || vehicleId || cardId || animalId);

  async function runOcrOnImage(localPath: string) {
    setOcrLoading(true);
    try {
      // Încearcă OCR pe imaginea curentă
      let { text } = await extractText(localPath);

      // Dacă textul e prea scurt (< 20 caractere), încearcă rotiri succesive
      if (text.trim().length < 20) {
        const rotations = [90, 180, 270];
        for (const deg of rotations) {
          const rotated = await ImageManipulator.manipulateAsync(localPath, [{ rotate: deg }], {
            compress: 0.9,
            format: ImageManipulator.SaveFormat.JPEG,
          });
          const result = await extractText(rotated.uri);
          if (result.text.trim().length > text.trim().length) {
            text = result.text;
            // Dacă am găsit orientarea corectă, salvează-o permanent
            if (result.text.trim().length >= 20) {
              await FileSystem.copyAsync({ from: rotated.uri, to: localPath });
              setPages(prev => {
                const idx = prev.findIndex(p => p.localPath === localPath);
                if (idx === -1) return prev;
                const next = [...prev];
                next[idx] = { ...next[idx], uri: rotated.uri };
                return next;
              });
              break;
            }
          }
        }
      }

      if (!text.trim()) return;
      const info = extractDocumentInfo(text);

      const foundExpiry = info.expiry_date && !expiryDate;
      if (foundExpiry) setExpiryDate(info.expiry_date!);
      if (info.issue_date && !issueDate) setIssueDate(info.issue_date);

      // Pre-populare câmpuri metadata specifice tipului din OCR
      const fields = DOCUMENT_FIELDS[type] ?? [];
      const ocrMetadata: Record<string, string> = {};
      for (const field of fields) {
        if (!field.ocrKey) continue;
        const ocrValue = (info as Record<string, string | undefined>)[field.ocrKey];
        if (ocrValue) ocrMetadata[field.key] = ocrValue;
      }
      // Extrage info specifice tipului
      if (type === 'factura') {
        const invoiceInfo = extractInvoiceInfo(text);
        if (invoiceInfo.invoice_number) ocrMetadata['invoice_number'] = invoiceInfo.invoice_number;
        if (invoiceInfo.amount) ocrMetadata['amount'] = invoiceInfo.amount;
        if (invoiceInfo.due_date) ocrMetadata['due_date'] = invoiceInfo.due_date;
      }
      if (type === 'bon_combustibil') {
        const fuelInfo = extractFuelInfo(text);
        if (fuelInfo.km) ocrMetadata['km'] = String(fuelInfo.km);
        if (fuelInfo.liters) ocrMetadata['liters'] = String(fuelInfo.liters);
        if (fuelInfo.price) ocrMetadata['total_amount'] = String(fuelInfo.price);
        if (fuelInfo.date && !issueDate) setIssueDate(fuelInfo.date);
      }
      if (['rca', 'itp', 'vigneta', 'talon', 'carte_auto'].includes(type)) {
        const plate = extractPlateNumber(text);
        if (plate) ocrMetadata['plate'] = plate;
      }
      if (Object.keys(ocrMetadata).length > 0) {
        setMetadata(prev => ({ ...ocrMetadata, ...prev }));
      }

      const found = [
        info.cnp ? `CNP: ${info.cnp}` : null,
        info.expiry_date ? `Expiră: ${info.expiry_date}` : null,
        info.issue_date ? `Emis: ${info.issue_date}` : null,
        info.series ? `Seria: ${info.series}` : null,
        info.name ? `Nume: ${info.name}` : null,
      ].filter(Boolean);

      if (found.length > 0 && !note) {
        setNote(found.join(' | '));
      }

      // Prompt reminder dacă s-a găsit dată de expirare
      if (foundExpiry) {
        setTimeout(() => {
          Alert.alert(
            'Dată expirare găsită',
            `OCR a detectat că documentul expiră pe ${info.expiry_date}.\nVrei să activez un reminder?`,
            [
              { text: 'Nu, mulțumesc', style: 'cancel' },
              {
                text: 'Activează reminder',
                onPress: () => {
                  scheduleExpirationReminders().catch(() => {});
                  Alert.alert('Reminder activat', 'Vei primi o notificare înainte de expirare conform setărilor.');
                },
              },
            ]
          );
        }, 500);
      }
    } catch {
      // OCR opțional — nu bloca userul
    } finally {
      setOcrLoading(false);
    }
  }

  function removePage(idx: number) {
    setPages(prev => prev.filter((_, i) => i !== idx));
  }

  async function processAndSaveImage(uri: string, optimize: boolean, exifOrientation?: number) {
    try {
      let finalUri = uri;

      // Auto-rotire bazată pe EXIF orientation
      if (exifOrientation && exifOrientation !== 1) {
        let rotationDegrees = 0;
        if (exifOrientation === 3) rotationDegrees = 180;
        else if (exifOrientation === 6) rotationDegrees = 90;
        else if (exifOrientation === 8) rotationDegrees = -90;

        if (rotationDegrees !== 0) {
          const rotated = await ImageManipulator.manipulateAsync(
            finalUri,
            [{ rotate: rotationDegrees }],
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
          );
          finalUri = rotated.uri;
        }
      }

      if (optimize) {
        finalUri = await applyDocumentScan(finalUri);
      }
      const filename = `doc_${Date.now()}.jpg`;
      const dir = `${FileSystem.documentDirectory}documents`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const dest = `${dir}/${filename}`;
      await FileSystem.copyAsync({ from: finalUri, to: dest });
      setPages(prev => [...prev, { uri: finalUri, localPath: dest }]);
      runOcrOnImage(dest); // OCR async, nu blochează UI
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut procesa imaginea');
    }
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisiune', 'Este nevoie de acces la galerie.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      exif: true,
    });
    if (!result.canceled && result.assets[0]) {
      const exifOrientation = result.assets[0].exif?.Orientation as number | undefined;
      await processAndSaveImage(result.assets[0].uri, false, exifOrientation);
    }
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisiune', 'Este nevoie de acces la cameră.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.9,
      exif: true,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      const exifOrientation = result.assets[0].exif?.Orientation as number | undefined;
      Alert.alert('Procesare imagine', 'Cum vrei să salvezi imaginea?', [
        {
          text: 'Scan document (optimizat)',
          onPress: () => processAndSaveImage(uri, true, exifOrientation),
        },
        {
          text: 'Poză normală',
          onPress: () => processAndSaveImage(uri, false, exifOrientation),
        },
        { text: 'Anulare', style: 'cancel' },
      ]);
    }
  }

  async function handleSubmit() {
    setLoading(true);
    try {
      const newDoc = await createDocument({
        type,
        custom_type_id: type === 'custom' ? (customTypeId ?? undefined) : undefined,
        issue_date: issueDate.trim() || undefined,
        expiry_date: expiryDate.trim() || undefined,
        note: note.trim() || undefined,
        file_path: pages[0]?.localPath || undefined,
        person_id: personId ?? selectedPersonId ?? undefined,
        property_id: propertyId ?? selectedPropertyId ?? undefined,
        vehicle_id: vehicleId ?? selectedVehicleId ?? undefined,
        card_id: cardId ?? selectedCardId ?? undefined,
        animal_id: animalId ?? selectedAnimalId ?? undefined,
        metadata: {
          ...metadata,
          ...(type === 'bon_combustibil' ? { is_full_tank: fullTank ? '1' : '0' } : {}),
        },
      });
      const { addDocumentPage } = await import('@/services/documents');
      for (let i = 1; i < pages.length; i++) {
        await addDocumentPage(newDoc.id, pages[i].localPath);
      }
      await refresh();
      scheduleExpirationReminders().catch(() => {});

      const finalExpiry = expiryDate.trim();
      if (finalExpiry && isCalendarAvailable()) {
        const entityName =
          (personId && persons.find(p => p.id === personId)?.name) ||
          (vehicleId && vehicles.find(v => v.id === vehicleId)?.name) ||
          (propertyId && properties.find(p => p.id === propertyId)?.name) ||
          undefined;
        setLoading(false);
        Alert.alert(
          'Adaugă în calendar?',
          `Vrei să adaugi un reminder în calendar pentru expirarea pe ${finalExpiry}?`,
          [
            { text: 'Nu', style: 'cancel', onPress: () => router.back() },
            {
              text: 'Adaugă',
              onPress: async () => {
                const id = await addExpiryCalendarEvent({ docType: type, expiryDate: finalExpiry, entityName });
                if (!id) Alert.alert('Eroare', 'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.');
                router.back();
              },
            },
          ]
        );
        return;
      }

      router.back();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva');
    } finally {
      setLoading(false);
    }
  }

  const linkedName =
    (personId && persons.find(p => p.id === personId)?.name) ||
    (propertyId && properties.find(p => p.id === propertyId)?.name) ||
    (vehicleId && vehicles.find(v => v.id === vehicleId)?.name) ||
    (cardId && cards.find(c => c.id === cardId)?.nickname) ||
    (animalId && animals.find(a => a.id === animalId)?.name) ||
    null;

  // Current entity list for picker
  const pickerEntities: { id: string; label: string }[] =
    pickerCategory === 'person'
      ? persons.map(p => ({ id: p.id, label: p.name }))
      : pickerCategory === 'property'
        ? properties.map(p => ({ id: p.id, label: p.name }))
        : pickerCategory === 'vehicle'
          ? vehicles.map(v => ({ id: v.id, label: v.name }))
          : pickerCategory === 'animal'
            ? animals.map(a => ({ id: a.id, label: a.name }))
            : cards.map(c => ({ id: c.id, label: c.nickname }));

  const selectedIdForCategory =
    pickerCategory === 'person'
      ? selectedPersonId
      : pickerCategory === 'property'
        ? selectedPropertyId
        : pickerCategory === 'vehicle'
          ? selectedVehicleId
          : pickerCategory === 'animal'
            ? selectedAnimalId
            : selectedCardId;

  function setSelectedForCategory(id: string | null) {
    if (pickerCategory === 'person') setSelectedPersonId(id);
    else if (pickerCategory === 'property') setSelectedPropertyId(id);
    else if (pickerCategory === 'vehicle') setSelectedVehicleId(id);
    else if (pickerCategory === 'animal') setSelectedAnimalId(id);
    else setSelectedCardId(id);
  }

  const anyEntitySelected = !!(
    selectedPersonId ||
    selectedPropertyId ||
    selectedVehicleId ||
    selectedCardId ||
    selectedAnimalId
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: C.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={[styles.scroll, { backgroundColor: C.background }]} contentContainerStyle={styles.scrollContent}>
        {linkedName && <Text style={styles.linked}>Legat de: {linkedName}</Text>}

        <Text style={styles.label}>Tip document</Text>
        <View style={styles.typeRow}>
          {STANDARD_TYPES.map(({ value, label }) => (
            <Pressable
              key={value}
              style={[styles.typeChip, type === value && styles.typeChipActive]}
              onPress={() => { setType(value); setCustomTypeId(null); setMetadata({}); }}
            >
              <Text style={[styles.typeChipText, type === value && styles.typeChipTextActive]}>
                {label}
              </Text>
            </Pressable>
          ))}
          {customTypes.map(ct => (
            <Pressable
              key={ct.id}
              style={[
                styles.typeChip,
                type === 'custom' && customTypeId === ct.id && styles.typeChipActive,
              ]}
              onPress={() => { setType('custom'); setCustomTypeId(ct.id); setMetadata({}); }}
            >
              <Text
                style={[
                  styles.typeChipText,
                  type === 'custom' && customTypeId === ct.id && styles.typeChipTextActive,
                ]}
              >
                {ct.name}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* ── Câmpuri specifice tipului de document ── */}
        {(DOCUMENT_FIELDS[type] ?? []).map((field: FieldDef) => (
          <View key={field.key}>
            <Text style={styles.label}>{field.label}</Text>
            <ThemedTextInput
              style={styles.input}
              placeholder={field.placeholder ?? ''}
              placeholderTextColor="#999"
              value={metadata[field.key] ?? ''}
              onChangeText={v => setMetadata(prev => ({ ...prev, [field.key]: v }))}
              keyboardType={field.keyboardType ?? 'default'}
              editable={!loading}
            />
          </View>
        ))}

        {/* ── Plin complet (bon combustibil) ── */}
        {type === 'bon_combustibil' && (
          <RNView style={[styles.switchRow, { backgroundColor: C.card, borderColor: C.border }]}>
            <RNView style={styles.switchLabel}>
              <RNText style={[styles.switchTitle, { color: C.text }]}>Plin complet</RNText>
              <RNText style={[styles.switchSub, { color: C.textSecondary }]}>
                {fullTank
                  ? 'Calculez consumul față de alimentarea anterioară'
                  : 'Nu calculez consumul (rezervor parțial)'}
              </RNText>
            </RNView>
            <Switch
              value={fullTank}
              onValueChange={setFullTank}
              trackColor={{ false: C.border, true: '#9EB567' }}
              thumbColor="#fff"
            />
          </RNView>
        )}

        <Text style={styles.label}>Data emisiune (opțional)</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="AAAA-LL-ZZ"
          placeholderTextColor="#999"
          value={issueDate}
          onChangeText={setIssueDate}
          editable={!loading}
        />
        <Text style={styles.label}>Data expirare (opțional)</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="AAAA-LL-ZZ"
          placeholderTextColor="#999"
          value={expiryDate}
          onChangeText={setExpiryDate}
          editable={!loading}
        />
        <Text style={styles.label}>Notă (opțional)</Text>
        <ThemedTextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Notă"
          placeholderTextColor="#999"
          value={note}
          onChangeText={setNote}
          multiline
          editable={!loading}
        />

        <Text style={styles.label}>
          Pagini / scan (
          {pages.length === 0
            ? 'nicio pagină'
            : `${pages.length} ${pages.length === 1 ? 'pagină' : 'pagini'}`}
          )
        </Text>
        {pages.map((page, idx) => (
          <View key={idx} style={styles.imageWrap}>
            <View style={styles.pageHeader}>
              <Text style={styles.pageLabel}>Pagina {idx + 1}</Text>
              <Pressable onPress={() => removePage(idx)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>Șterge</Text>
              </Pressable>
            </View>
            <Image source={{ uri: page.uri }} style={styles.preview} resizeMode="contain" />
          </View>
        ))}
        <View style={styles.photoRow}>
          <Pressable style={styles.photoBtn} onPress={takePhoto}>
            <Text style={styles.photoBtnText}>{pages.length === 0 ? 'Cameră' : '+ Cameră'}</Text>
          </Pressable>
          <Pressable style={styles.photoBtn} onPress={pickImage}>
            <Text style={styles.photoBtnText}>{pages.length === 0 ? 'Galerie' : '+ Galerie'}</Text>
          </Pressable>
        </View>
        {ocrLoading && <Text style={styles.ocrHint}>Se analizează documentul...</Text>}

        {/* Entity picker — doar dacă nu vine din entitate */}
        {!hasParamLink && (
          <>
            <Text style={[styles.label, styles.sectionLabel]}>
              Leagă de entitate (opțional)
              {anyEntitySelected && <Text style={styles.selectedBadge}> ✓</Text>}
            </Text>

            {/* Category tabs */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryRow} contentContainerStyle={styles.categoryRowContent}>
              {ENTITY_CATEGORIES.map(({ key, label }) => (
                <Pressable
                  key={key}
                  style={[styles.categoryTab, pickerCategory === key && styles.categoryTabActive]}
                  onPress={() => setPickerCategory(key)}
                >
                  <Text
                    style={[
                      styles.categoryTabText,
                      pickerCategory === key && styles.categoryTabTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Entity list for selected category */}
            {pickerEntities.length === 0 ? (
              <Text style={styles.pickerEmpty}>Nicio entitate adăugată.</Text>
            ) : (
              <View style={styles.entityList}>
                {/* Niciunul */}
                <Pressable
                  style={[
                    styles.entityItem,
                    selectedIdForCategory === null && styles.entityItemActive,
                  ]}
                  onPress={() => setSelectedForCategory(null)}
                >
                  <Text
                    style={[
                      styles.entityItemText,
                      selectedIdForCategory === null && styles.entityItemTextActive,
                    ]}
                  >
                    Niciunul
                  </Text>
                </Pressable>
                {pickerEntities.map(e => (
                  <Pressable
                    key={e.id}
                    style={[
                      styles.entityItem,
                      selectedIdForCategory === e.id && styles.entityItemActive,
                    ]}
                    onPress={() => setSelectedForCategory(e.id)}
                  >
                    <Text
                      style={[
                        styles.entityItemText,
                        selectedIdForCategory === e.id && styles.entityItemTextActive,
                      ]}
                    >
                      {e.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <Text style={styles.buttonText}>{loading ? 'Se salvează...' : 'Salvează'}</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 48 },
  linked: { fontSize: 14, opacity: 0.8, marginBottom: 16 },
  label: { fontSize: 14, marginBottom: 6, opacity: 0.9 },
  sectionLabel: { marginTop: 8, fontSize: 15, fontWeight: '600', opacity: 1 },
  selectedBadge: { color: primary },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  typeChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  typeChipActive: { backgroundColor: primary, borderColor: primary },
  typeChipText: { fontSize: 14 },
  typeChipTextActive: { color: '#fff', fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  inputMultiline: { minHeight: 80 },
  imageWrap: { marginBottom: 16 },
  pageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  pageLabel: { fontSize: 13, fontWeight: '600', opacity: 0.7 },
  preview: { width: '100%', height: 200, borderRadius: 12, backgroundColor: '#f0f0f0' },
  removeBtn: { paddingVertical: 4 },
  removeBtnText: { color: '#c00', fontSize: 14 },
  photoRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  photoBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: primary,
    alignItems: 'center',
  },
  photoBtnText: { color: primary, fontWeight: '500' },
  // Entity picker
  categoryRow: { marginBottom: 12, marginTop: 8 },
  categoryRowContent: { flexDirection: 'row', gap: 8 },
  categoryTab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
    alignItems: 'center',
  },
  categoryTabActive: { backgroundColor: primary, borderColor: primary },
  categoryTabText: { fontSize: 12, fontWeight: '500' },
  categoryTabTextActive: { color: '#fff' },
  entityList: { marginBottom: 20 },
  entityItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    marginBottom: 8,
  },
  entityItemActive: { backgroundColor: primary, borderColor: primary },
  entityItemText: { fontSize: 15 },
  entityItemTextActive: { color: '#fff', fontWeight: '500' },
  pickerEmpty: { opacity: 0.6, fontSize: 14, marginBottom: 20 },
  ocrHint: { fontSize: 12, opacity: 0.6, textAlign: 'center', marginTop: 4 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 20,
  },
  switchLabel: { flex: 1, marginRight: 12 },
  switchTitle: { fontSize: 15, fontWeight: '500' },
  switchSub: { fontSize: 12, marginTop: 2 },
  // Submit
  button: {
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPressed: { opacity: 0.9 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
