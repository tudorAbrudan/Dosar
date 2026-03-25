import { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  Pressable,
  ActivityIndicator,
  Modal,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@react-navigation/native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { primary } from '@/theme/colors';
import { DatePickerField } from '@/components/DatePickerField';
import { DocumentPhotoSection } from '@/components/DocumentPhotoSection';
import type { PhotoPage } from '@/components/DocumentPhotoSection';
import {
  getDocumentById,
  updateDocument,
  addDocumentPage,
  removeDocumentPage,
  setDocumentOcrText,
  linkDocumentToEntity,
  getDocumentsByEntity,
} from '@/services/documents';
import { scheduleExpirationReminders } from '@/services/notifications';
import { addExpiryCalendarEvent, isCalendarAvailable } from '@/services/calendar';
import { extractText, extractDocumentInfo, detectDocumentType, formatOcrSummary } from '@/services/ocr';
import { extractFieldsForType } from '@/services/ocrExtractors';
import { toFileUri } from '@/services/fileUtils';
import { DOCUMENT_TYPE_LABELS, getDocumentLabel } from '@/types';
import type { Document as DocType, DocumentType } from '@/types';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useFilteredDocTypes } from '@/hooks/useFilteredDocTypes';
import { useEntities } from '@/hooks/useEntities';
import { DOCUMENT_FIELDS } from '@/types/documentFields';
import type { FieldDef } from '@/types/documentFields';

export default function EditDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { customTypes } = useCustomTypes();
  const { docTypeOptions: standardTypes } = useFilteredDocTypes();
  const { companies, persons, properties, vehicles, cards, animals } = useEntities();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [doc, setDoc] = useState<DocType | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [fullscreenUri, setFullscreenUri] = useState<string | null>(null);
  const [linkEntityVisible, setLinkEntityVisible] = useState(false);
  const [typePickerVisible, setTypePickerVisible] = useState(false);
  const [rotatedUris, setRotatedUris] = useState<Record<string, string>>({});

  // Form state — populated when doc loads
  const [type, setType] = useState<DocumentType>('buletin');
  const [customTypeId, setCustomTypeId] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const expiryDateRef = useRef('');
  const [note, setNote] = useState('');
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [autoDelete, setAutoDelete] = useState<string | null>(null);

  // Pre-completează data expirării ITP din talonul vehiculului (dacă lipsește)
  useEffect(() => {
    if (!doc || doc.type !== 'itp' || doc.expiry_date || !doc.vehicle_id) return;
    getDocumentsByEntity('vehicle_id', doc.vehicle_id)
      .then(docs => {
        const talon = docs.find(d => d.type === 'talon');
        const itpDate = talon?.metadata?.itp_expiry_date;
        if (itpDate) {
          setExpiryDate(itpDate);
          expiryDateRef.current = itpDate;
        }
      })
      .catch(() => {});
  }, [doc?.id, doc?.type, doc?.vehicle_id, doc?.expiry_date]);

  useEffect(() => {
    if (!id) return;
    getDocumentById(id)
      .then(d => {
        if (!d) return;
        setDoc(d);
        setType(d.type);
        setCustomTypeId(d.custom_type_id ?? null);
        setIssueDate(d.issue_date ?? '');
        setExpiryDate(d.expiry_date ?? '');
        expiryDateRef.current = d.expiry_date ?? '';
        setNote(d.note ?? '');
        setMetadata(d.metadata ?? {});
        setAutoDelete(d.auto_delete ?? null);
      })
      .catch(() => {})
      .finally(() => setLoadingDoc(false));
  }, [id]);

  const allPages = useMemo(() => {
    if (!doc) return [];
    const main = doc.file_path ? [{ id: '__main__', file_path: doc.file_path }] : [];
    const extra = (doc.pages ?? []).map(p => ({ id: p.id, file_path: p.file_path }));
    return [...main, ...extra];
  }, [doc]);

  const photoPages: PhotoPage[] = useMemo(
    () =>
      allPages.map(p => ({
        id: p.id,
        uri: rotatedUris[p.file_path] ?? toFileUri(p.file_path),
      })),
    [allPages, rotatedUris]
  );

  // ── Photo management (immediate, persists to DB) ─────────────────────────

  async function handleRotate(pageId: string, degrees: number) {
    const page = allPages.find(p => p.id === pageId);
    if (!page) return;
    const sourceUri = rotatedUris[page.file_path] ?? toFileUri(page.file_path);
    try {
      const result = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ rotate: degrees }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      setRotatedUris(prev => ({ ...prev, [page.file_path]: result.uri }));
      const absoluteUri = toFileUri(page.file_path);
      const dest = absoluteUri.startsWith('file://') ? absoluteUri.slice(7) : absoluteUri;
      await FileSystem.copyAsync({ from: result.uri, to: dest });
    } catch {
      Alert.alert('Eroare', 'Nu s-a putut roti imaginea.');
    }
  }

  async function handleDeletePage(pageId: string) {
    if (!doc) return;
    Alert.alert('Șterge pagina', 'Ești sigur că vrei să ștergi această pagină?', [
      { text: 'Anulare', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          try {
            if (pageId === '__main__') {
              await updateDocument(doc.id, {
                type: doc.type,
                issue_date: doc.issue_date,
                expiry_date: doc.expiry_date,
                note: doc.note,
                file_path: undefined,
              });
            } else {
              await removeDocumentPage(pageId);
            }
            const updated = await getDocumentById(doc.id);
            setDoc(updated);
            const deletedPage = allPages.find(p => p.id === pageId);
            if (deletedPage) {
              setRotatedUris(prev => {
                const next = { ...prev };
                delete next[deletedPage.file_path];
                return next;
              });
            }
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge pagina');
          }
        },
      },
    ]);
  }

  async function saveAndAddPage(uri: string) {
    if (!doc) return;
    try {
      const filename = `doc_${Date.now()}.jpg`;
      const relativePath = `documents/${filename}`;
      const dest = `${FileSystem.documentDirectory}${relativePath}`;
      await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}documents`, { intermediates: true });
      const normalized = await ImageManipulator.manipulateAsync(
        uri, [], { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );
      await FileSystem.copyAsync({ from: normalized.uri, to: dest });
      if (!doc.file_path) {
        await updateDocument(doc.id, {
          type: doc.type,
          issue_date: doc.issue_date,
          expiry_date: doc.expiry_date,
          note: doc.note,
          file_path: relativePath,
          auto_delete: doc.auto_delete,
        });
      } else {
        await addDocumentPage(doc.id, relativePath);
      }
      const updated = await getDocumentById(doc.id);
      setDoc(updated);
      if (updated) runOcrOnNewPage(relativePath, updated);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut adăuga pagina');
    }
  }

  function handleAddPage() {
    Alert.alert('Adaugă pagină', '', [
      {
        text: 'Cameră',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permisiune', 'Este nevoie de acces la cameră.'); return; }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
          if (!result.canceled && result.assets[0]) await saveAndAddPage(result.assets[0].uri);
        },
      },
      {
        text: 'Galerie',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permisiune', 'Este nevoie de acces la galerie.'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
          if (!result.canceled && result.assets[0]) await saveAndAddPage(result.assets[0].uri);
        },
      },
      { text: 'Anulare', style: 'cancel' },
    ]);
  }

  // ── OCR ──────────────────────────────────────────────────────────────────

  async function ocrWithAutoRotate(storedPath: string): Promise<{ text: string; rotated: boolean }> {
    const fileUri = toFileUri(storedPath);
    let { text } = await extractText(fileUri);
    if (text.trim().length >= 30) return { text, rotated: false };

    let bestText = text;
    let bestUri = fileUri;
    for (const deg of [90, 270, 180]) {
      const r = await ImageManipulator.manipulateAsync(
        fileUri, [{ rotate: deg }], { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );
      const { text: rotText } = await extractText(r.uri);
      if (rotText.trim().length > bestText.trim().length) {
        bestText = rotText;
        bestUri = r.uri;
      }
      if (bestText.trim().length >= 30) break;
    }

    const wasRotated = bestUri !== fileUri;
    if (wasRotated) {
      const absoluteUri = toFileUri(storedPath);
      const destPath = absoluteUri.startsWith('file://') ? absoluteUri.slice(7) : absoluteUri;
      await FileSystem.copyAsync({ from: bestUri, to: destPath });
    }
    return { text: bestText, rotated: wasRotated };
  }

  async function runOcrOnNewPage(localPath: string, currentDoc: DocType) {
    try {
      const { text, rotated } = await ocrWithAutoRotate(localPath);
      if (!text.trim()) return;
      const detectedType = detectDocumentType(text);
      const info = extractDocumentInfo(text);
      const summary = formatOcrSummary(text, info);
      const updates: Parameters<typeof updateDocument>[1] = {
        type: (detectedType && detectedType !== 'altul' && detectedType !== 'custom') ? detectedType : currentDoc.type,
        issue_date: info.issue_date ?? currentDoc.issue_date,
        expiry_date: info.expiry_date ?? currentDoc.expiry_date,
        note: (!currentDoc.note && summary) ? summary : currentDoc.note,
        file_path: currentDoc.file_path,
        auto_delete: currentDoc.auto_delete,
      };
      await updateDocument(currentDoc.id, updates);
      const existingOcr = currentDoc.ocr_text ?? '';
      await setDocumentOcrText(currentDoc.id, existingOcr ? `${existingOcr}\n\n---\n\n${text}` : text);
      const updated = await getDocumentById(currentDoc.id);
      setDoc(updated);
      if (updated) {
        setType(updated.type);
        if (updated.issue_date) setIssueDate(updated.issue_date);
        if (updated.expiry_date) { setExpiryDate(updated.expiry_date); expiryDateRef.current = updated.expiry_date; }
        if (!note && updated.note) setNote(updated.note);
        if (updated.metadata) setMetadata(prev => ({ ...updated.metadata!, ...prev }));
      }
      if (rotated) setRotatedUris({});
    } catch { /* OCR opțional */ }
  }

  const handleOcr = async () => {
    if (allPages.length === 0) {
      Alert.alert('Fără imagini', 'Nu există imagini atașate acestui document.');
      return;
    }
    setOcrLoading(true);
    try {
      const texts: string[] = [];
      let anyRotated = false;
      for (const page of allPages) {
        try {
          const { text, rotated } = await ocrWithAutoRotate(page.file_path);
          if (text.trim()) texts.push(text);
          if (rotated) anyRotated = true;
        } catch { /* pagina nu a putut fi scanată */ }
      }
      if (anyRotated) setRotatedUris({});

      const combinedText = texts.join('\n');
      if (!combinedText.trim()) {
        Alert.alert('OCR', 'Nu s-a putut extrage text din imagini.');
        return;
      }

      const info = extractDocumentInfo(combinedText);
      const summary = formatOcrSummary(combinedText, info);
      const extracted = doc ? extractFieldsForType(doc.type, combinedText) : { metadata: {} };
      const newExpiry = extracted.expiry_date ?? info.expiry_date;
      const newIssue = extracted.issue_date ?? info.issue_date;

      const found: string[] = [];
      Object.entries(extracted.metadata).slice(0, 5).forEach(([, v]) => found.push(`• ${v}`));
      if (newExpiry) found.push(`📅 Expiră: ${newExpiry}`);
      if (newIssue) found.push(`📅 Emis: ${newIssue}`);

      const pageLabel = `${allPages.length} ${allPages.length === 1 ? 'pagină' : 'pagini'}`;
      const message = found.length > 0
        ? `Găsit din ${pageLabel}:\n\n${found.join('\n')}`
        : `Text extras din ${pageLabel}:\n\n${combinedText.slice(0, 400)}${combinedText.length > 400 ? '…' : ''}`;

      Alert.alert('Procesare OCR', message, [
        { text: 'Închide', style: 'cancel' },
        found.length > 0
          ? {
              text: 'Aplică pe document',
              onPress: async () => {
                if (newExpiry) { setExpiryDate(newExpiry); expiryDateRef.current = newExpiry; }
                if (newIssue) setIssueDate(newIssue);
                if (!note && summary) setNote(summary);
                setMetadata(prev => ({ ...extracted.metadata, ...prev }));
                await setDocumentOcrText(doc!.id, combinedText);
                const updated = await getDocumentById(doc!.id);
                setDoc(updated);
                Alert.alert('Aplicat', 'Datele OCR au fost completate în formular.');
              },
            }
          : {
              text: 'Copiază în notă',
              onPress: async () => {
                setNote(combinedText.slice(0, 500));
                await setDocumentOcrText(doc!.id, combinedText);
                const updated = await getDocumentById(doc!.id);
                setDoc(updated);
              },
            },
      ]);
    } catch (e) {
      Alert.alert('Eroare OCR', e instanceof Error ? e.message : 'Eroare la procesare');
    } finally {
      setOcrLoading(false);
    }
  };

  // ── Entity ────────────────────────────────────────────────────────────────

  async function handleLinkEntity(entity: {
    person_id?: string; property_id?: string; vehicle_id?: string;
    card_id?: string; animal_id?: string; company_id?: string;
  }) {
    if (!doc) return;
    await linkDocumentToEntity(doc.id, entity);
    const updated = await getDocumentById(doc.id);
    if (updated) setDoc(updated);
    setLinkEntityVisible(false);
  }

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!doc) return;
    setSaving(true);
    try {
      await updateDocument(doc.id, {
        type,
        custom_type_id: type === 'custom' ? (customTypeId ?? undefined) : undefined,
        issue_date: issueDate.trim() || undefined,
        expiry_date: expiryDateRef.current.trim() || undefined,
        note: note.trim() || undefined,
        file_path: doc.file_path,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        auto_delete: autoDelete ?? undefined,
      });
      scheduleExpirationReminders().catch(() => {});

      const finalExpiry = expiryDateRef.current.trim();
      if (finalExpiry && isCalendarAvailable()) {
        setSaving(false);
        Alert.alert(
          'Adaugă în calendar?',
          `Vrei să adaugi un reminder pentru expirarea pe ${finalExpiry}?`,
          [
            { text: 'Nu', style: 'cancel', onPress: () => router.back() },
            {
              text: 'Adaugă',
              onPress: async () => {
                const calId = await addExpiryCalendarEvent({ docType: type, expiryDate: finalExpiry, entityName: undefined, documentId: doc.id, note: note.trim() || undefined });
                if (!calId) Alert.alert('Eroare', 'Nu s-a putut accesa calendarul.');
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
      setSaving(false);
    }
  };

  // ── Entity display ────────────────────────────────────────────────────────

  let entityName: string | null = null;
  if (doc?.person_id) entityName = persons.find(p => p.id === doc.person_id)?.name ?? null;
  else if (doc?.property_id) entityName = properties.find(p => p.id === doc.property_id)?.name ?? null;
  else if (doc?.vehicle_id) entityName = vehicles.find(v => v.id === doc.vehicle_id)?.name ?? null;
  else if (doc?.card_id) {
    const c = cards.find(c => c.id === doc.card_id);
    entityName = c ? `${c.nickname ?? ''} ····${c.last4}`.trim() : null;
  } else if (doc?.animal_id) entityName = animals.find(a => a.id === doc.animal_id)?.name ?? null;
  else if (doc?.company_id) entityName = companies.find(c => c.id === doc.company_id)?.name ?? null;

  if (loadingDoc || !doc) {
    return (
      <View style={styles.center}>
        <Text>{loadingDoc ? 'Se încarcă...' : 'Document negăsit'}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: getDocumentLabel(doc, customTypes),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingRight: 16 }}>
              <Text style={{ color: primary, fontSize: 16 }}>Anulează</Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          {/* 1. POZE & OCR */}
          <Text style={styles.sectionLabel}>Poze / scan</Text>
          <DocumentPhotoSection
            pages={photoPages}
            ocrLoading={ocrLoading}
            ocrText={doc.ocr_text ?? undefined}
            onAddPage={handleAddPage}
            onRotate={handleRotate}
            onDelete={handleDeletePage}
            onRunOcr={handleOcr}
            onFullscreen={setFullscreenUri}
          />

          {/* 2. TIP DOCUMENT */}
          <Text style={styles.label}>Tip document</Text>
          <Pressable
            style={styles.typeToggleRow}
            onPress={() => setTypePickerVisible(v => !v)}
          >
            <Text style={styles.typeToggleCurrent}>
              {type === 'custom'
                ? (customTypes.find(c => c.id === customTypeId)?.name ?? 'Tip personalizat')
                : (DOCUMENT_TYPE_LABELS[type] ?? type)}
            </Text>
            <Text style={styles.typeToggleChevron}>{typePickerVisible ? '▲' : '▼ Schimbă'}</Text>
          </Pressable>
          {typePickerVisible && (
            <View style={styles.typeRow}>
              {standardTypes.map(({ value, label }) => (
                <Pressable
                  key={value}
                  style={[styles.typeChip, type === value && styles.typeChipActive]}
                  onPress={() => { setType(value); setCustomTypeId(null); setTypePickerVisible(false); }}
                >
                  <Text style={[styles.typeChipText, type === value && styles.typeChipTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
              {customTypes.map(ct => (
                <Pressable
                  key={ct.id}
                  style={[styles.typeChip, type === 'custom' && customTypeId === ct.id && styles.typeChipActive]}
                  onPress={() => { setType('custom'); setCustomTypeId(ct.id); setTypePickerVisible(false); }}
                >
                  <Text style={[styles.typeChipText, type === 'custom' && customTypeId === ct.id && styles.typeChipTextActive]}>
                    {ct.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* 3. LEGAT DE ENTITATE */}
          <Text style={styles.label}>Legat de</Text>
          <Pressable style={styles.entityRow} onPress={() => setLinkEntityVisible(true)}>
            <Text style={[styles.entityValue, !entityName && styles.entityPlaceholder]}>
              {entityName ?? 'Nelegat'}
            </Text>
            <Text style={styles.entityEditHint}>Schimbă</Text>
          </Pressable>

          {/* 4. CÂMPURI SPECIFICE TIPULUI */}
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
                editable={!saving}
              />
            </View>
          ))}

          {/* 5. DATE */}
          <DatePickerField
            label="Data emisiune (opțional)"
            value={issueDate}
            onChange={setIssueDate}
            disabled={saving}
          />
          <DatePickerField
            label="Data expirare (opțional)"
            value={expiryDate}
            onChange={v => { expiryDateRef.current = v; setExpiryDate(v); }}
            disabled={saving}
          />

          {/* 6. AUTO-ȘTERGERE */}
          <Text style={styles.label}>Auto-ștergere (opțional)</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow} style={styles.chipsScroll}>
            {([
              ...(expiryDate ? [{ label: 'La expirare', value: 'expiry' }] : []),
              { label: 'Niciodată', value: null },
              { label: '30 zile', value: '30d' },
              { label: '90 zile', value: '90d' },
              { label: '180 zile', value: '180d' },
              { label: '1 an', value: '365d' },
            ] as { label: string; value: string | null }[]).map(opt => (
              <Pressable
                key={opt.value ?? 'never'}
                style={[styles.typeChip, autoDelete === opt.value && styles.typeChipActive]}
                onPress={() => setAutoDelete(opt.value)}
              >
                <Text style={[styles.typeChipText, autoDelete === opt.value && styles.typeChipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* 7. NOTĂ */}
          <Text style={styles.label}>Notă (opțional)</Text>
          <ThemedTextInput
            style={[styles.input, styles.inputMultiline]}
            placeholder="Notă"
            placeholderTextColor="#999"
            value={note}
            onChangeText={setNote}
            multiline
            editable={!saving}
          />

          {/* 8. ACȚIUNI */}
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.btnOutline, saving && styles.btnDisabled]}
              onPress={() => router.back()}
              disabled={saving}
            >
              <Text style={styles.btnOutlineText}>Anulează</Text>
            </Pressable>
            <Pressable
              style={[styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnPrimaryText}>Salvează</Text>}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Fullscreen modal */}
      <Modal visible={!!fullscreenUri} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.fsOverlay}>
          <StatusBar hidden />
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.fsScrollContent}
            maximumZoomScale={6}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
            bouncesZoom
          >
            {fullscreenUri && (
              <Image
                source={{ uri: fullscreenUri }}
                style={{ width: screenWidth, height: screenHeight }}
                resizeMode="contain"
              />
            )}
          </ScrollView>
          <Pressable style={styles.fsCloseBtn} onPress={() => setFullscreenUri(null)}>
            <Text style={styles.fsCloseBtnText}>✕</Text>
          </Pressable>
        </View>
      </Modal>

      {/* Link entity overlay */}
      {linkEntityVisible && (
        <View style={styles.overlay}>
          <View style={[styles.overlayBox, { backgroundColor: colors.card }]}>
            <Text style={styles.overlayTitle}>Asociază cu o entitate</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
              {persons.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Persoane</Text>
                  {persons.map(p => (
                    <Pressable key={p.id} style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                      onPress={() => handleLinkEntity({ person_id: p.id })}>
                      <Text style={styles.entityPickerText}>{p.name}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {vehicles.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Vehicule</Text>
                  {vehicles.map(v => (
                    <Pressable key={v.id} style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                      onPress={() => handleLinkEntity({ vehicle_id: v.id })}>
                      <Text style={styles.entityPickerText}>{v.name}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {properties.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Proprietăți</Text>
                  {properties.map(p => (
                    <Pressable key={p.id} style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                      onPress={() => handleLinkEntity({ property_id: p.id })}>
                      <Text style={styles.entityPickerText}>{p.name}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {cards.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Carduri</Text>
                  {cards.map(c => (
                    <Pressable key={c.id} style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                      onPress={() => handleLinkEntity({ card_id: c.id })}>
                      <Text style={styles.entityPickerText}>{c.nickname ?? ''} ····{c.last4}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {animals.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Animale</Text>
                  {animals.map(a => (
                    <Pressable key={a.id} style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                      onPress={() => handleLinkEntity({ animal_id: a.id })}>
                      <Text style={styles.entityPickerText}>{a.name}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              {companies.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Firme</Text>
                  {companies.map(c => (
                    <Pressable key={c.id} style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                      onPress={() => handleLinkEntity({ company_id: c.id })}>
                      <Text style={styles.entityPickerText}>{c.name}</Text>
                    </Pressable>
                  ))}
                </>
              )}
              <Pressable
                style={styles.entityPickerRowDanger}
                onPress={() => handleLinkEntity({})}
              >
                <Text style={styles.entityPickerDangerText}>Elimină legătura</Text>
              </Pressable>
            </ScrollView>
            <Pressable
              style={[styles.btnOutline, { marginTop: 12 }]}
              onPress={() => setLinkEntityVisible(false)}
            >
              <Text style={styles.btnOutlineText}>Anulare</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { padding: 20, paddingBottom: 48 },
  sectionLabel: { fontSize: 15, fontWeight: '600', opacity: 1, marginBottom: 10, marginTop: 4 },
  label: { fontSize: 14, marginBottom: 6, opacity: 0.9 },
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
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  typeChip: {
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 20, borderWidth: 1, borderColor: '#ccc',
  },
  typeChipActive: { backgroundColor: primary, borderColor: primary },
  typeChipText: { fontSize: 14 },
  typeChipTextActive: { color: '#fff', fontWeight: '500' },
  typeToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12,
  },
  typeToggleCurrent: { fontSize: 15, fontWeight: '500', flex: 1 },
  typeToggleChevron: { fontSize: 13, color: primary, fontWeight: '500' },
  entityRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 20,
  },
  entityValue: { fontSize: 15, flex: 1 },
  entityPlaceholder: { opacity: 0.4 },
  entityEditHint: { fontSize: 13, color: primary, fontWeight: '500' },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btnOutline: {
    flex: 1, paddingVertical: 15, borderRadius: 12,
    borderWidth: 1, borderColor: primary, alignItems: 'center',
  },
  btnOutlineText: { color: primary, fontSize: 16, fontWeight: '500' },
  btnPrimary: {
    flex: 1, paddingVertical: 15, borderRadius: 12,
    backgroundColor: primary, alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  chipsScroll: { marginBottom: 20 },
  chipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  // Fullscreen
  fsOverlay: { flex: 1, backgroundColor: '#000' },
  fsScrollContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fsCloseBtn: {
    position: 'absolute', top: 52, right: 20,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  fsCloseBtnText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  // Entity overlay
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  overlayBox: {
    borderRadius: 16, padding: 20,
    width: '100%', maxHeight: '80%',
  },
  overlayTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  entityGroupLabel: {
    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    opacity: 0.5, letterSpacing: 0.5, marginTop: 12, marginBottom: 4,
  },
  entityPickerRow: {
    paddingVertical: 14, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entityPickerText: { fontSize: 15 },
  entityPickerRowDanger: { paddingVertical: 14, marginTop: 8 },
  entityPickerDangerText: { color: '#c00', fontSize: 15 },
});
