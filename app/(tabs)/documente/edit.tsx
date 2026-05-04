import { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  Pressable,
  ActivityIndicator,
  Modal,
  StatusBar,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { FormPageScreen } from '@/components/ui/FormPageScreen';
import { primary, statusColors, sensitive, sensitiveBorder, sensitiveBg } from '@/theme/colors';
import { DatePickerField } from '@/components/DatePickerField';
import { DocumentPhotoSection } from '@/components/DocumentPhotoSection';
import type { PhotoPage } from '@/components/DocumentPhotoSection';
import {
  getDocumentById,
  updateDocument,
  addDocumentPage,
  removeDocumentPage,
  setDocumentOcrText,
  reorderAllDocumentFiles,
  getDocumentsByEntity,
  addEntityLinkToDocument,
  removeEntityLinkFromDocument,
  getDocumentEntityLinks,
  lockPageOrientation,
  lockMainOrientation,
  setDocumentCalendarEventId,
} from '@/services/documents';
import { scheduleExpirationReminders } from '@/services/notifications';
import {
  addExpiryCalendarEvent,
  addEventToCalendar,
  updateExpiryCalendarEvent,
  updateBiletCalendarEvent,
  deleteCalendarEvent,
  isCalendarAvailable,
} from '@/services/calendar';
import {
  extractText,
  extractDocumentInfo,
  detectDocumentType,
  formatOcrSummary,
} from '@/services/ocr';
import { extractFieldsForType } from '@/services/ocrExtractors';
import { toFileUri } from '@/services/fileUtils';
import { isPdfFile, extractTextFromPdf } from '@/services/pdfExtractor';
import { renderPdfFirstPageForVision } from '@/services/pdfOcr';
import { extractFieldsWithLlm } from '@/services/ocrLlmExtractor';
import { AI_CONSENT_KEY } from '@/services/aiProvider';
import * as ocrConsent from '@/services/ocrConsent';
import { DOCUMENT_TYPE_LABELS, getDocumentLabel } from '@/types';
import type { Document as DocType, DocumentType, DocumentEntityLink, EntityType } from '@/types';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useFilteredDocTypes } from '@/hooks/useFilteredDocTypes';
import { useEntities } from '@/hooks/useEntities';
import { DOCUMENT_FIELDS } from '@/types/documentFields';
import type { FieldDef } from '@/types/documentFields';

const DELETE_OPTIONS: { label: string; value: string | null }[] = [
  { label: 'Niciodată', value: null },
  { label: '30 zile', value: '30d' },
  { label: '90 zile', value: '90d' },
  { label: '180 zile', value: '180d' },
  { label: '1 an', value: '365d' },
  { label: '2 ani', value: '730d' },
  { label: '3 ani', value: '1095d' },
  { label: '4 ani', value: '1460d' },
  { label: '5 ani', value: '1825d' },
];

function autoDeleteLabel(val: string | null): string {
  return DELETE_OPTIONS.find(o => o.value === val)?.label ?? 'Niciodată';
}

export default function EditDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const headerHeight = useHeaderHeight();
  const { customTypes } = useCustomTypes();
  const { docTypeOptions: standardTypes } = useFilteredDocTypes();
  const { companies, persons, properties, vehicles, cards, animals } = useEntities();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [doc, setDoc] = useState<DocType | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [aiOcrLoading] = useState(false);
  const [aiOcrApplied, setAiOcrApplied] = useState(false);
  const [llmFieldLoading, setLlmFieldLoading] = useState(false);
  const [textAiConsentAvailable, setTextAiConsentAvailable] = useState(false);
  const [fullscreenUri, setFullscreenUri] = useState<string | null>(null);

  function handleFullscreen(uri: string) {
    setFullscreenUri(uri);
  }
  const [linkEntityVisible, setLinkEntityVisible] = useState(false);
  const [entityLinks, setEntityLinks] = useState<DocumentEntityLink[]>([]);
  const [typePickerVisible, setTypePickerVisible] = useState(false);
  const [rotatedUris, setRotatedUris] = useState<Record<string, string>>({});

  // Form state — populated when doc loads
  const [type, setType] = useState<DocumentType>('buletin');
  const [customTypeId, setCustomTypeId] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const expiryDateRef = useRef('');
  const [note, setNote] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');
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
        setPrivateNotes(d.private_notes ?? '');
        setMetadata(d.metadata ?? {});
        setAutoDelete(d.auto_delete ?? null);
      })
      .catch(() => {})
      .finally(() => setLoadingDoc(false));
    getDocumentEntityLinks(id)
      .then(links => setEntityLinks(links))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    AsyncStorage.getItem(AI_CONSENT_KEY).then(v => setTextAiConsentAvailable(v === 'true'));
  }, []);

  const allPages = useMemo(() => {
    if (!doc) return [];
    const main = doc.file_path
      ? [
          {
            id: '__main__',
            file_path: doc.file_path,
            orientation_locked: doc.main_orientation_locked,
          },
        ]
      : [];
    const extra = (doc.pages ?? []).map(p => ({
      id: p.id,
      file_path: p.file_path,
      orientation_locked: p.orientation_locked,
    }));
    return [...main, ...extra];
  }, [doc]);

  const entityName = useMemo<string | null>(() => {
    if (!doc) return null;
    if (doc.person_id) return persons.find(p => p.id === doc.person_id)?.name ?? null;
    if (doc.property_id) return properties.find(p => p.id === doc.property_id)?.name ?? null;
    if (doc.vehicle_id) return vehicles.find(v => v.id === doc.vehicle_id)?.name ?? null;
    if (doc.card_id) {
      const c = cards.find(c => c.id === doc.card_id);
      return c ? `${c.nickname ?? ''} ····${c.last4}`.trim() : null;
    }
    if (doc.animal_id) return animals.find(a => a.id === doc.animal_id)?.name ?? null;
    if (doc.company_id) return companies.find(c => c.id === doc.company_id)?.name ?? null;
    return null;
  }, [doc, persons, properties, vehicles, cards, animals, companies]);

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
    if (!doc) return;
    const page = allPages.find(p => p.id === pageId);
    if (!page) return;
    const sourceUri = rotatedUris[page.file_path] ?? toFileUri(page.file_path);
    try {
      const result = await ImageManipulator.manipulateAsync(sourceUri, [{ rotate: degrees }], {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      setRotatedUris(prev => ({ ...prev, [page.file_path]: result.uri }));
      const absoluteUri = toFileUri(page.file_path);
      const dest = absoluteUri.startsWith('file://') ? absoluteUri.slice(7) : absoluteUri;
      await FileSystem.copyAsync({ from: result.uri, to: dest });
      // Lock orientarea — OCR-ul nu va mai încerca auto-rotire pe această pagină.
      if (pageId === '__main__') {
        await lockMainOrientation(doc.id);
      } else {
        await lockPageOrientation(pageId);
      }
      const updated = await getDocumentById(doc.id);
      if (updated) setDoc(updated);
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

  async function handleReorderPage(fromIndex: number, toIndex: number) {
    if (!doc) return;
    const paths = allPages.map(p => p.file_path);
    const newPaths = [...paths];
    const [moved] = newPaths.splice(fromIndex, 1);
    newPaths.splice(toIndex, 0, moved);
    try {
      await reorderAllDocumentFiles(doc.id, newPaths);
      const updated = await getDocumentById(doc.id);
      setDoc(updated);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut reordona');
    }
  }

  async function handleOcrSave(text: string) {
    if (!doc) return;
    await setDocumentOcrText(doc.id, text);
    const updated = await getDocumentById(doc.id);
    setDoc(updated);
  }

  async function runAiImageAnalysis() {
    if (allPages.length === 0) {
      Alert.alert('Fără imagini', 'Nu există imagini atașate documentului.');
      return;
    }
    if (ocrConsent.getDocTypeSensitivity(type) === 'medical') {
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Date medicale (GDPR Art. 9)',
          `Imaginea documentului „${DOCUMENT_TYPE_LABELS[type]}" va fi trimisă la AI.\n\nPreferința nu se salvează.\n\nEști de acord?`,
          [
            { text: 'Anulează', style: 'cancel', onPress: () => resolve(false) },
            { text: 'De acord', onPress: () => resolve(true) },
          ]
        );
      });
      if (!confirmed) return;
    }
    setLlmFieldLoading(true);
    try {
      const firstPage = allPages[0];
      const pageUri = rotatedUris[firstPage.file_path] ?? toFileUri(firstPage.file_path);
      let imageBase64: string | undefined;
      if (isPdfFile(firstPage.file_path)) {
        imageBase64 = (await renderPdfFirstPageForVision(pageUri)) ?? undefined;
      } else {
        imageBase64 = await FileSystem.readAsStringAsync(pageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
      const ocrText = doc?.ocr_text ?? '';
      const extracted = await extractFieldsWithLlm(type, ocrText, imageBase64);
      if (Object.keys(extracted.metadata).length > 0)
        setMetadata(prev => ({ ...extracted.metadata, ...prev }));
      if (extracted.expiry_date) {
        setExpiryDate(extracted.expiry_date);
        expiryDateRef.current = extracted.expiry_date;
      }
      if (extracted.issue_date) setIssueDate(extracted.issue_date);
      if (extracted.note) setNote(extracted.note);
      setAiOcrApplied(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (msg.includes('limita')) Alert.alert('Limită AI atinsă', msg);
      // alte erori (JSON parse, rețea temporară) sunt silențioase
    } finally {
      setLlmFieldLoading(false);
    }
  }

  async function saveAndAddPage(uri: string) {
    if (!doc) return;
    try {
      const filename = `doc_${Date.now()}.jpg`;
      const relativePath = `documents/${filename}`;
      const dest = `${FileSystem.documentDirectory}${relativePath}`;
      await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}documents`, {
        intermediates: true,
      });
      const normalized = await ImageManipulator.manipulateAsync(uri, [], {
        compress: 0.92,
        format: ImageManipulator.SaveFormat.JPEG,
      });
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

  async function saveAndAddPdf(uri: string) {
    if (!doc) return;
    try {
      const filename = `doc_${Date.now()}.pdf`;
      const relativePath = `documents/${filename}`;
      const dest = `${FileSystem.documentDirectory}${relativePath}`;
      await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}documents`, {
        intermediates: true,
      });
      await FileSystem.copyAsync({ from: uri, to: dest });
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
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut adăuga PDF-ul');
    }
  }

  function handleAddPage() {
    Alert.alert('Adaugă pagină', '', [
      {
        text: 'Cameră',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permisiune', 'Este nevoie de acces la cameră.');
            return;
          }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            quality: 1,
          });
          if (!result.canceled && result.assets[0]) await saveAndAddPage(result.assets[0].uri);
        },
      },
      {
        text: 'Galerie',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') {
            Alert.alert('Permisiune', 'Este nevoie de acces la galerie.');
            return;
          }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 1,
          });
          if (!result.canceled && result.assets[0]) await saveAndAddPage(result.assets[0].uri);
        },
      },
      {
        text: 'Adaugă PDF',
        onPress: async () => {
          try {
            const result = await DocumentPicker.getDocumentAsync({
              type: 'application/pdf',
              copyToCacheDirectory: true,
            });
            if (!result.canceled && result.assets[0]?.uri) {
              await saveAndAddPdf(result.assets[0].uri);
            }
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut selecta PDF-ul');
          }
        },
      },
      { text: 'Anulare', style: 'cancel' },
    ]);
  }

  // ── OCR ──────────────────────────────────────────────────────────────────

  async function ocrWithAutoRotate(
    storedPath: string,
    isLocked: boolean
  ): Promise<{ text: string; rotated: boolean }> {
    const fileUri = toFileUri(storedPath);
    const { text } = await extractText(fileUri);

    // Pagină rotită manual de user — respectă orientarea, nu mai încerca alte rotații.
    if (isLocked) return { text, rotated: false };

    // Încearcă mereu toate cele 3 rotații — threshold-ul >= 50 era insuficient deoarece
    // Vision pe iOS modern extrage ≥50 chars chiar și din imagini rotite greșit.
    let bestText = text;
    let bestUri = fileUri;
    for (const deg of [90, 270, 180]) {
      const r = await ImageManipulator.manipulateAsync(fileUri, [{ rotate: deg }], {
        compress: 0.92,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      const { text: rotText } = await extractText(r.uri);
      if (rotText.trim().length > bestText.trim().length) {
        bestText = rotText;
        bestUri = r.uri;
      }
    }

    const wasRotated = bestUri !== fileUri;
    if (wasRotated) {
      // Folosim fileUri direct (cu file://) — destPath fără prefix arunca excepție
      // care era prinsă silențios, împiedicând salvarea imaginii și extragerea datelor.
      await FileSystem.copyAsync({ from: bestUri, to: fileUri });
    }
    return { text: bestText, rotated: wasRotated };
  }

  async function runOcrOnNewPage(localPath: string, currentDoc: DocType) {
    try {
      // Pagină nou-adăugată — niciodată lock-uită; lăsăm auto-rotate să încerce
      const { text, rotated } = await ocrWithAutoRotate(localPath, false);
      if (!text.trim()) return;
      const detectedType = detectDocumentType(text);
      const info = extractDocumentInfo(text);
      const summary = formatOcrSummary(text, info);
      const updates: Parameters<typeof updateDocument>[1] = {
        type:
          detectedType && detectedType !== 'altul' && detectedType !== 'custom'
            ? detectedType
            : currentDoc.type,
        issue_date: info.issue_date ?? currentDoc.issue_date,
        expiry_date: info.expiry_date ?? currentDoc.expiry_date,
        note: !currentDoc.note && summary ? summary : currentDoc.note,
        file_path: currentDoc.file_path,
        auto_delete: currentDoc.auto_delete,
      };
      await updateDocument(currentDoc.id, updates);
      const existingOcr = currentDoc.ocr_text ?? '';
      await setDocumentOcrText(
        currentDoc.id,
        existingOcr ? `${existingOcr}\n\n---\n\n${text}` : text
      );
      const updated = await getDocumentById(currentDoc.id);
      setDoc(updated);
      if (updated) {
        setType(updated.type);
        if (updated.issue_date) setIssueDate(updated.issue_date);
        if (updated.expiry_date) {
          setExpiryDate(updated.expiry_date);
          expiryDateRef.current = updated.expiry_date;
        }
        if (!note && updated.note) setNote(updated.note);
        if (updated.metadata) setMetadata(prev => ({ ...updated.metadata!, ...prev }));
      }
      if (rotated) setRotatedUris({});
    } catch {
      /* OCR opțional */
    }
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
          if (isPdfFile(page.file_path)) {
            const pdfText = await extractTextFromPdf(toFileUri(page.file_path));
            if (pdfText.trim()) texts.push(pdfText);
          } else {
            const { text, rotated } = await ocrWithAutoRotate(
              page.file_path,
              page.orientation_locked
            );
            if (text.trim()) texts.push(text);
            if (rotated) anyRotated = true;
          }
        } catch {
          /* pagina nu a putut fi scanată */
        }
      }
      if (anyRotated) setRotatedUris({});

      const combinedText = texts.join('\n');
      if (!combinedText.trim()) {
        Alert.alert('OCR', 'Nu s-a putut extrage text din imagini.');
        return;
      }

      const info = extractDocumentInfo(combinedText);
      const summary = formatOcrSummary(combinedText, info);
      const detectedType = detectDocumentType(combinedText);
      const typeChanged =
        detectedType &&
        detectedType !== 'altul' &&
        detectedType !== 'custom' &&
        detectedType !== doc?.type;
      const effectiveType = (typeChanged ? detectedType : doc?.type) ?? 'altul';
      const extracted = extractFieldsForType(effectiveType, combinedText);
      const newExpiry = extracted.expiry_date ?? info.expiry_date;
      const newIssue = extracted.issue_date ?? info.issue_date;

      const found: string[] = [];
      Object.entries(extracted.metadata)
        .slice(0, 5)
        .forEach(([, v]) => found.push(`• ${v}`));
      if (newExpiry) found.push(`📅 Expiră: ${newExpiry}`);
      if (newIssue) found.push(`📅 Emis: ${newIssue}`);

      const pageLabel = `${allPages.length} ${allPages.length === 1 ? 'pagină' : 'pagini'}`;
      const typeNote = typeChanged ? `\n\n📋 Tip detectat: ${effectiveType}` : '';
      const message =
        found.length > 0
          ? `Găsit din ${pageLabel}:${typeNote}\n\n${found.join('\n')}`
          : `Text extras din ${pageLabel}:${typeNote}\n\n${combinedText.slice(0, 400)}${combinedText.length > 400 ? '…' : ''}`;

      Alert.alert('Procesare OCR', message, [
        { text: 'Închide', style: 'cancel' },
        found.length > 0 || typeChanged
          ? {
              text: typeChanged
                ? `Aplică (schimbă tipul în ${effectiveType})`
                : 'Aplică pe document',
              onPress: async () => {
                if (typeChanged) setType(effectiveType as DocumentType);
                if (newExpiry) {
                  setExpiryDate(newExpiry);
                  expiryDateRef.current = newExpiry;
                }
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

  async function handleAddEntityLink(link: DocumentEntityLink) {
    if (!doc) return;
    await addEntityLinkToDocument(doc.id, link);
    const updated = await getDocumentEntityLinks(doc.id);
    setEntityLinks(updated);
    setLinkEntityVisible(false);
  }

  async function handleRemoveEntityLink(link: DocumentEntityLink) {
    if (!doc) return;
    await removeEntityLinkFromDocument(doc.id, link);
    const updated = await getDocumentEntityLinks(doc.id);
    setEntityLinks(updated);
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
        private_notes: privateNotes.trim() || undefined,
      });
      scheduleExpirationReminders().catch(() => {});

      const navigateBack = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/documente');
      };

      if (!isCalendarAvailable()) {
        navigateBack();
        return;
      }

      const finalExpiry = expiryDateRef.current.trim();
      const isBilet = type === 'bilet';
      const biletDate = isBilet ? metadata.event_date?.trim() : undefined;
      const hasEvent = doc.calendar_event_id;

      // Dacă documentul are deja un eveniment în calendar, facem silent update / delete.
      if (hasEvent) {
        if (isBilet && biletDate) {
          const newId = await updateBiletCalendarEvent(hasEvent, {
            title:
              [metadata.categorie, metadata.venue].filter(Boolean).join(' – ') || 'Eveniment',
            eventDate: biletDate,
            venue: metadata.venue,
            note: note.trim() || undefined,
            documentId: doc.id,
          });
          if (newId && newId !== hasEvent) await setDocumentCalendarEventId(doc.id, newId);
        } else if (!isBilet && finalExpiry) {
          const newId = await updateExpiryCalendarEvent(hasEvent, {
            docType: type,
            expiryDate: finalExpiry,
            entityName: entityName ?? undefined,
            documentId: doc.id,
            note: note.trim() || undefined,
          });
          if (newId && newId !== hasEvent) await setDocumentCalendarEventId(doc.id, newId);
        } else {
          // Userul a șters data → ștergem și eventul.
          await deleteCalendarEvent(hasEvent);
          await setDocumentCalendarEventId(doc.id, null);
        }
        navigateBack();
        return;
      }

      // Fără eveniment existent → comportamentul curent (Alert).
      if (isBilet && biletDate) {
        const title =
          [metadata.categorie, metadata.venue].filter(Boolean).join(' – ') || 'Eveniment';
        setSaving(false);
        Alert.alert('Adaugă în calendar?', `Vrei reminder pentru evenimentul din ${biletDate}?`, [
          { text: 'Nu', style: 'cancel', onPress: navigateBack },
          {
            text: 'Adaugă',
            onPress: async () => {
              const calId = await addEventToCalendar({
                title,
                eventDate: biletDate,
                venue: metadata.venue,
                note: note.trim() || undefined,
                documentId: doc.id,
              });
              if (calId) await setDocumentCalendarEventId(doc.id, calId);
              else Alert.alert('Eroare', 'Nu s-a putut accesa calendarul.');
              navigateBack();
            },
          },
        ]);
        return;
      }

      if (!isBilet && finalExpiry) {
        setSaving(false);
        Alert.alert(
          'Adaugă în calendar?',
          `Vrei să adaugi un reminder pentru expirarea pe ${finalExpiry}?`,
          [
            { text: 'Nu', style: 'cancel', onPress: navigateBack },
            {
              text: 'Adaugă',
              onPress: async () => {
                const calId = await addExpiryCalendarEvent({
                  docType: type,
                  expiryDate: finalExpiry,
                  entityName: entityName ?? undefined,
                  documentId: doc.id,
                  note: note.trim() || undefined,
                });
                if (calId) await setDocumentCalendarEventId(doc.id, calId);
                else Alert.alert('Eroare', 'Nu s-a putut accesa calendarul.');
                navigateBack();
              },
            },
          ]
        );
        return;
      }

      navigateBack();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva');
    } finally {
      setSaving(false);
    }
  };

  if (loadingDoc || !doc) {
    return (
      <View style={styles.center}>
        <Text>{loadingDoc ? 'Se încarcă...' : 'Document negăsit'}</Text>
      </View>
    );
  }

  return (
    <>
      <FormPageScreen
        title={getDocumentLabel(doc, customTypes)}
        onSave={handleSave}
        saving={saving}
        scrollContentStyle={styles.content}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {/* 1. POZE & OCR */}
        <Text style={styles.sectionLabel}>Poze / scan</Text>
        <DocumentPhotoSection
          pages={photoPages}
          ocrLoading={ocrLoading || aiOcrLoading}
          ocrText={doc.ocr_text ?? undefined}
          onAddPage={handleAddPage}
          onRotate={handleRotate}
          onDelete={handleDeletePage}
          onRunOcr={handleOcr}
          onFullscreen={handleFullscreen}
          onReorderPage={handleReorderPage}
          onOcrTextSave={handleOcrSave}
        />
        {aiOcrApplied && (
          <View style={[styles.aiBadge, { backgroundColor: '#f0f5e8' }]}>
            <Text style={[styles.aiBadgeText, { color: primary }]}>
              ✦ Câmpuri completate cu AI · Verifică înainte de salvare
            </Text>
          </View>
        )}
        {(aiOcrLoading || llmFieldLoading) && (
          <View style={styles.aiLoadingRow}>
            <ActivityIndicator size="small" color={primary} style={{ marginRight: 6 }} />
            <Text style={styles.aiLoadingText}>
              {llmFieldLoading ? 'Analizez documentul cu AI...' : 'Analizez cu AI...'}
            </Text>
          </View>
        )}
        {textAiConsentAvailable && allPages.length > 0 && !llmFieldLoading && (
          <View>
            <View style={styles.aiActionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.aiActionBtn,
                  { borderColor: '#F57F17', opacity: pressed ? 0.75 : 1 },
                ]}
                onPress={runAiImageAnalysis}
              >
                <Text style={[styles.aiActionBtnText, { color: '#F57F17' }]}>
                  Trimite documentul la AI
                </Text>
              </Pressable>
            </View>
            <Text style={styles.aiActionInfo}>
              Se trimite imaginea/PDF-ul documentului la AI pentru extragerea datelor. Acțiune
              manuală explicită.
            </Text>
          </View>
        )}

        {/* 2. TIP DOCUMENT */}
        <Text style={styles.label}>Tip document</Text>
        <Pressable
          style={[styles.typeToggleRow, { borderColor: colors.border }]}
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
            {standardTypes.map(({ value, label }) => {
              const active = type === value;
              return (
                <Pressable
                  key={value}
                  style={[
                    styles.typeChip,
                    { borderColor: colors.border },
                    active && styles.typeChipActive,
                  ]}
                  onPress={() => {
                    setType(value);
                    setCustomTypeId(null);
                    setTypePickerVisible(false);
                  }}
                >
                  <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            {customTypes.map(ct => {
              const active = type === 'custom' && customTypeId === ct.id;
              return (
                <Pressable
                  key={ct.id}
                  style={[
                    styles.typeChip,
                    { borderColor: colors.border },
                    active && styles.typeChipActive,
                  ]}
                  onPress={() => {
                    setType('custom');
                    setCustomTypeId(ct.id);
                    setTypePickerVisible(false);
                  }}
                >
                  <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                    {ct.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {/* 3. LEGAT DE ENTITATE */}
        <Text style={styles.label}>Legat de</Text>
        {(() => {
          const ENTITY_ICONS: Record<EntityType, string> = {
            person: '👤',
            vehicle: '🚗',
            property: '🏠',
            card: '💳',
            animal: '🐾',
            company: '🏢',
          };
          function entityLinkLabel(link: DocumentEntityLink): string {
            switch (link.entityType) {
              case 'person':
                return persons.find(p => p.id === link.entityId)?.name ?? link.entityId;
              case 'vehicle':
                return vehicles.find(v => v.id === link.entityId)?.name ?? link.entityId;
              case 'property':
                return properties.find(p => p.id === link.entityId)?.name ?? link.entityId;
              case 'card': {
                const c = cards.find(c => c.id === link.entityId);
                return c ? `${c.nickname} ····${c.last4}` : link.entityId;
              }
              case 'animal':
                return animals.find(a => a.id === link.entityId)?.name ?? link.entityId;
              case 'company':
                return companies.find(c => c.id === link.entityId)?.name ?? link.entityId;
              default:
                return link.entityId;
            }
          }
          return (
            <View style={styles.entityLinksRow}>
              {entityLinks.length === 0 && (
                <Text style={[styles.entityValue, styles.entityPlaceholder]}>Nelegat</Text>
              )}
              {entityLinks.map((link, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.entityChip,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.entityChipText, { color: colors.text }]}>
                    {ENTITY_ICONS[link.entityType]} {entityLinkLabel(link)}
                  </Text>
                  <Pressable
                    onPress={() => handleRemoveEntityLink(link)}
                    hitSlop={8}
                    style={styles.entityChipRemove}
                  >
                    <Text style={{ color: statusColors.critical, fontSize: 14, fontWeight: '700' }}>
                      ✕
                    </Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                style={[styles.entityAddBtn, { borderColor: primary }]}
                onPress={() => setLinkEntityVisible(true)}
              >
                <Text style={[styles.entityAddBtnText, { color: primary }]}>+ Adaugă</Text>
              </Pressable>
            </View>
          );
        })()}

        {/* 4. CÂMPURI SPECIFICE TIPULUI */}
        {(DOCUMENT_FIELDS[type] ?? []).map((field: FieldDef) => (
          <View key={field.key}>
            <Text style={styles.label}>{field.label}</Text>
            <ThemedTextInput
              style={styles.input}
              placeholder={field.placeholder ?? ''}
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
          onChange={v => {
            expiryDateRef.current = v;
            setExpiryDate(v);
          }}
          disabled={saving}
        />

        {/* 6. AUTO-ȘTERGERE */}
        <Text style={styles.label}>
          {'Auto-ștergere (opțional)'}
          {autoDelete !== null ? `: ${autoDeleteLabel(autoDelete)}` : ''}
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
          style={styles.chipsScroll}
        >
          {(
            [
              ...(expiryDate ? [{ label: 'La expirare', value: 'expiry' }] : []),
              ...DELETE_OPTIONS,
            ] as { label: string; value: string | null }[]
          ).map(opt => {
            const active = autoDelete === opt.value;
            return (
              <Pressable
                key={opt.value ?? 'never'}
                style={[
                  styles.typeChip,
                  { borderColor: colors.border },
                  active && styles.typeChipActive,
                ]}
                onPress={() => setAutoDelete(opt.value)}
              >
                <Text style={[styles.typeChipText, active && styles.typeChipTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* 7. NOTĂ */}
        <Text style={styles.label}>Notă (opțional)</Text>
        <ThemedTextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Notă"
          value={note}
          onChangeText={setNote}
          multiline
          editable={!saving}
        />

        {/* 7b. NOTĂ PRIVATĂ — nu se trimite la AI */}
        <View style={styles.privateLabelRow}>
          <Ionicons name="lock-closed" size={14} color={sensitive} />
          <Text style={[styles.label, { color: sensitive, opacity: 1 }]}>
            Notă privată (opțional)
          </Text>
        </View>
        <Text style={[styles.privateHint, { color: colors.text }]}>
          Rămâne pe acest telefon. Nu se trimite niciodată la asistentul AI. Potrivită pentru CVV,
          PIN, parole, coduri de acces.
        </Text>
        <ThemedTextInput
          style={[styles.input, styles.inputMultiline, styles.privateInput]}
          placeholder="Ex. CVV 123 · PIN 4821"
          placeholderTextColor="#999"
          value={privateNotes}
          onChangeText={setPrivateNotes}
          multiline
          editable={!saving}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </FormPageScreen>

      {/* Fullscreen modal */}
      <Modal visible={!!fullscreenUri} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.fsOverlay}>
          <StatusBar hidden />
          <ScrollView
            key={fullscreenUri}
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
                key={fullscreenUri}
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
            <Text style={styles.overlayTitle}>Adaugă entitate asociată</Text>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              {persons.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Persoane</Text>
                  {persons.map(p => {
                    const linked = entityLinks.some(
                      l => l.entityType === 'person' && l.entityId === p.id
                    );
                    return (
                      <Pressable
                        key={p.id}
                        style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                        onPress={() =>
                          handleAddEntityLink({ entityType: 'person', entityId: p.id })
                        }
                      >
                        <Text style={styles.entityPickerText}>{p.name}</Text>
                        {linked && <Text style={{ color: primary, fontSize: 13 }}>✓ Adăugat</Text>}
                      </Pressable>
                    );
                  })}
                </>
              )}
              {vehicles.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Vehicule</Text>
                  {vehicles.map(v => {
                    const linked = entityLinks.some(
                      l => l.entityType === 'vehicle' && l.entityId === v.id
                    );
                    return (
                      <Pressable
                        key={v.id}
                        style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                        onPress={() =>
                          handleAddEntityLink({ entityType: 'vehicle', entityId: v.id })
                        }
                      >
                        <Text style={styles.entityPickerText}>{v.name}</Text>
                        {linked && <Text style={{ color: primary, fontSize: 13 }}>✓ Adăugat</Text>}
                      </Pressable>
                    );
                  })}
                </>
              )}
              {properties.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Proprietăți</Text>
                  {properties.map(p => {
                    const linked = entityLinks.some(
                      l => l.entityType === 'property' && l.entityId === p.id
                    );
                    return (
                      <Pressable
                        key={p.id}
                        style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                        onPress={() =>
                          handleAddEntityLink({ entityType: 'property', entityId: p.id })
                        }
                      >
                        <Text style={styles.entityPickerText}>{p.name}</Text>
                        {linked && <Text style={{ color: primary, fontSize: 13 }}>✓ Adăugat</Text>}
                      </Pressable>
                    );
                  })}
                </>
              )}
              {cards.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Carduri</Text>
                  {cards.map(c => {
                    const linked = entityLinks.some(
                      l => l.entityType === 'card' && l.entityId === c.id
                    );
                    return (
                      <Pressable
                        key={c.id}
                        style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                        onPress={() => handleAddEntityLink({ entityType: 'card', entityId: c.id })}
                      >
                        <Text style={styles.entityPickerText}>
                          {c.nickname ?? ''} ····{c.last4}
                        </Text>
                        {linked && <Text style={{ color: primary, fontSize: 13 }}>✓ Adăugat</Text>}
                      </Pressable>
                    );
                  })}
                </>
              )}
              {animals.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Animale</Text>
                  {animals.map(a => {
                    const linked = entityLinks.some(
                      l => l.entityType === 'animal' && l.entityId === a.id
                    );
                    return (
                      <Pressable
                        key={a.id}
                        style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                        onPress={() =>
                          handleAddEntityLink({ entityType: 'animal', entityId: a.id })
                        }
                      >
                        <Text style={styles.entityPickerText}>{a.name}</Text>
                        {linked && <Text style={{ color: primary, fontSize: 13 }}>✓ Adăugat</Text>}
                      </Pressable>
                    );
                  })}
                </>
              )}
              {companies.length > 0 && (
                <>
                  <Text style={styles.entityGroupLabel}>Firme</Text>
                  {companies.map(c => {
                    const linked = entityLinks.some(
                      l => l.entityType === 'company' && l.entityId === c.id
                    );
                    return (
                      <Pressable
                        key={c.id}
                        style={[styles.entityPickerRow, { borderBottomColor: colors.border }]}
                        onPress={() =>
                          handleAddEntityLink({ entityType: 'company', entityId: c.id })
                        }
                      >
                        <Text style={styles.entityPickerText}>{c.name}</Text>
                        {linked && <Text style={{ color: primary, fontSize: 13 }}>✓ Adăugat</Text>}
                      </Pressable>
                    );
                  })}
                </>
              )}
            </ScrollView>
            <Pressable
              style={[styles.btnPrimary, { marginTop: 12 }]}
              onPress={() => setLinkEntityVisible(false)}
            >
              <Text style={styles.btnPrimaryText}>Închide</Text>
            </Pressable>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  content: { padding: 20, paddingBottom: 48 },
  sectionLabel: { fontSize: 15, fontWeight: '600', opacity: 1, marginBottom: 10, marginTop: 4 },
  label: { fontSize: 14, marginBottom: 6, opacity: 0.9 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  inputMultiline: { minHeight: 80 },
  privateLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  privateHint: { fontSize: 12, marginBottom: 8, lineHeight: 16, opacity: 0.6 },
  privateInput: { borderColor: sensitiveBorder, backgroundColor: sensitiveBg },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  typeChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  typeChipActive: { backgroundColor: primary, borderColor: primary },
  typeChipText: { fontSize: 14 },
  typeChipTextActive: { color: '#fff', fontWeight: '500' },
  typeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  typeToggleCurrent: { fontSize: 15, fontWeight: '500', flex: 1 },
  typeToggleChevron: { fontSize: 13, color: primary, fontWeight: '500' },
  entityLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  entityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  entityChipText: { fontSize: 13, fontWeight: '500' },
  entityChipRemove: { padding: 2 },
  entityAddBtn: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  entityAddBtnText: { fontSize: 13, fontWeight: '500' },
  entityValue: { fontSize: 15, flex: 1 },
  entityPlaceholder: { opacity: 0.4 },
  actionRow: { flexDirection: 'row', gap: 12, marginTop: 8 },
  aiBadge: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, marginTop: 8 },
  aiBadgeText: { fontSize: 13, fontWeight: '600' },
  aiLoadingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  aiLoadingText: { fontSize: 12, fontStyle: 'italic', color: '#666' },
  aiActionsRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  aiActionBtn: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1 },
  aiActionBtnText: { fontSize: 13, fontWeight: '600' },
  aiActionInfo: { fontSize: 11, marginTop: 4, lineHeight: 15, color: '#888' },
  btnOutline: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: primary,
    alignItems: 'center',
  },
  btnOutlineText: { color: primary, fontSize: 16, fontWeight: '500', textAlign: 'center' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: primary,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  btnDisabled: { opacity: 0.5 },
  chipsScroll: { marginBottom: 20 },
  chipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  // Fullscreen
  fsOverlay: { flex: 1, backgroundColor: '#000' },
  fsScrollContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fsCloseBtn: {
    position: 'absolute',
    top: 52,
    right: 20,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fsCloseBtnText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  // Entity overlay
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  overlayBox: {
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxHeight: '80%',
  },
  overlayTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  entityGroupLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    opacity: 0.5,
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 4,
  },
  entityPickerRow: {
    paddingVertical: 14,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  entityPickerText: { fontSize: 15 },
  entityPickerRowDanger: { paddingVertical: 14, marginTop: 8 },
  entityPickerDangerText: { color: statusColors.critical, fontSize: 15 },
});
