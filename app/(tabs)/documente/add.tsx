import { useRef, useState, useEffect } from 'react';
import {
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Modal,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { extractTextFromPdf, isPdfFile } from '@/services/pdfExtractor';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { useDocuments } from '@/hooks/useDocuments';
import { useEntities } from '@/hooks/useEntities';
import { scheduleExpirationReminders } from '@/services/notifications';
import {
  addExpiryCalendarEvent,
  addEventToCalendar,
  isCalendarAvailable,
} from '@/services/calendar';
import {
  extractText,
  extractDocumentInfo,
  detectDocumentType,
  formatOcrSummary,
} from '@/services/ocr';
import { extractFieldsForType } from '@/services/ocrExtractors';
import { reconstructLayout } from '@/services/ocrLayout';
import { toRelativePath } from '@/services/fileUtils';
import { getDocumentsByEntity, findDuplicateDocument } from '@/services/documents';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { Document } from '@/types';
import type { DocumentType, EntityType, DocumentEntityLink } from '@/types';
import { DatePickerField } from '@/components/DatePickerField';
import { DOCUMENT_FIELDS } from '@/types/documentFields';
import type { FieldDef } from '@/types/documentFields';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { DocumentPhotoSection } from '@/components/DocumentPhotoSection';
import type { PhotoPage } from '@/components/DocumentPhotoSection';
import { mapOcrWithAi } from '@/services/aiOcrMapper';
import type { AvailableEntities } from '@/services/aiOcrMapper';

const AI_CONSENT_KEY = 'ai_assistant_consent_accepted';

const ALL_STANDARD_TYPES = Object.entries(DOCUMENT_TYPE_LABELS)
  .filter(([value]) => value !== 'custom')
  .map(([value, label]) => ({ value: value as DocumentType, label }));

const HIDE_EXPIRY_TYPES: DocumentType[] = [
  'analize_medicale',
  'carte_auto',
  'cadastru',
  'act_proprietate',
];
const CUSTOM_EXPIRY_LABEL: Partial<Record<DocumentType, string>> = {
  talon: 'Scadență ITP (pentru reminder)',
};

const ENTITY_CATEGORIES: { key: EntityType; label: string }[] = [
  { key: 'person', label: 'Persoană' },
  { key: 'property', label: 'Proprietate' },
  { key: 'vehicle', label: 'Vehicul' },
  { key: 'card', label: 'Card' },
  { key: 'animal', label: 'Animal' },
  { key: 'company', label: 'Firmă' },
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
    company_id?: string;
    type?: string;
  }>();
  const { createDocument, refresh } = useDocuments();
  const { persons, properties, vehicles, cards, animals, companies } = useEntities();
  const { customTypes } = useCustomTypes();
  const { visibleEntityTypes, visibleDocTypes } = useVisibilitySettings();

  const [type, setType] = useState<DocumentType>((params.type as DocumentType) || 'buletin');
  const [customTypeId, setCustomTypeId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const expiryDateRef = useRef('');
  const issueDateRef = useRef('');
  const [note, setNote] = useState('');
  const [autoDelete, setAutoDelete] = useState<string | null>(null);
  const [pages, setPages] = useState<{ uri: string; localPath: string }[]>([]);
  const ocrTextsRef = useRef<Map<string, string>>(new Map());
  const ocrStructuredTextsRef = useRef<Map<string, string>>(new Map());
  const [liveOcrText, setLiveOcrText] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [aiOcrLoading, setAiOcrLoading] = useState(false);
  const [aiOcrApplied, setAiOcrApplied] = useState(false);
  const lastAiTextLengthRef = useRef(0);
  const [aiConsentAvailable, setAiConsentAvailable] = useState(false);
  const [duplicateDoc, setDuplicateDoc] = useState<Document | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(AI_CONSENT_KEY).then(v => setAiConsentAvailable(v === 'true'));
  }, []);

  const [fullscreenUri, setFullscreenUri] = useState<string | null>(null);
  const [typePickerVisible, setTypePickerVisible] = useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Entity picker state
  const [pickerCategory, setPickerCategory] = useState<EntityType>('person');
  const [entityLinks, setEntityLinks] = useState<DocumentEntityLink[]>(() => {
    const initial: DocumentEntityLink[] = [];
    if (params.person_id) initial.push({ entityType: 'person', entityId: params.person_id });
    if (params.property_id) initial.push({ entityType: 'property', entityId: params.property_id });
    if (params.vehicle_id) initial.push({ entityType: 'vehicle', entityId: params.vehicle_id });
    if (params.card_id) initial.push({ entityType: 'card', entityId: params.card_id });
    if (params.animal_id) initial.push({ entityType: 'animal', entityId: params.animal_id });
    if (params.company_id) initial.push({ entityType: 'company', entityId: params.company_id });
    return initial;
  });

  const personId = params.person_id;
  const propertyId = params.property_id;
  const vehicleId = params.vehicle_id;
  const cardId = params.card_id;
  const animalId = params.animal_id;
  const companyId = params.company_id;
  const hasParamLink = !!(personId || propertyId || vehicleId || cardId || animalId || companyId);

  useEffect(() => {
    if (entityLinks.length === 0) {
      setDuplicateDoc(null);
      return;
    }
    findDuplicateDocument(type, customTypeId ?? undefined, entityLinks)
      .then(setDuplicateDoc)
      .catch(() => setDuplicateDoc(null));
  }, [type, customTypeId, entityLinks]);

  // Pre-completează data expirării ITP din talonul vehiculului (dacă există)
  useEffect(() => {
    const vid = vehicleId ?? entityLinks.find(l => l.entityType === 'vehicle')?.entityId;
    if (type !== 'itp' || !vid || expiryDateRef.current) return;
    getDocumentsByEntity('vehicle_id', vid)
      .then(docs => {
        const talon = docs.find(d => d.type === 'talon');
        const itpDate = talon?.metadata?.itp_expiry_date;
        if (itpDate && !expiryDateRef.current) {
          // Convertim ZZ.LL.AAAA → AAAA-LL-ZZ pentru DatePickerField
          const m = itpDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
          const isoDate = m ? `${m[3]}-${m[2]}-${m[1]}` : itpDate;
          setExpiryDate(isoDate);
          expiryDateRef.current = isoDate;
        }
      })
      .catch(() => {});
  }, [type, vehicleId, entityLinks]);

  // PhotoPage array for DocumentPhotoSection (uses localPath as id)
  const photoPages: PhotoPage[] = pages.map(p => ({ id: p.localPath, uri: p.uri }));

  // ── OCR ──────────────────────────────────────────────────────────────────

  async function runOcrOnImage(localPath: string, skipLoadingState = false) {
    if (!skipLoadingState) setOcrLoading(true);
    try {
      let { text, rawBlocks } = await extractText(localPath);

      if (text.trim().length < 50) {
        const candidates: {
          deg: number;
          text: string;
          rawBlocks: typeof rawBlocks;
          uri: string;
        }[] = [];
        for (const deg of [90, 180, 270]) {
          const rotated = await ImageManipulator.manipulateAsync(localPath, [{ rotate: deg }], {
            compress: 1,
            format: ImageManipulator.SaveFormat.JPEG,
          });
          const result = await extractText(rotated.uri);
          candidates.push({
            deg,
            text: result.text,
            rawBlocks: result.rawBlocks,
            uri: rotated.uri,
          });
        }
        const best = candidates.reduce((a, b) =>
          a.text.trim().length >= b.text.trim().length ? a : b
        );
        if (best.text.trim().length > text.trim().length) {
          text = best.text;
          rawBlocks = best.rawBlocks;
          await FileSystem.copyAsync({ from: best.uri, to: localPath });
          setPages(prev => {
            const idx = prev.findIndex(p => p.localPath === localPath);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], uri: best.uri };
            return next;
          });
        }
      }

      if (!text.trim()) {
        ocrTextsRef.current.delete(localPath);
        ocrStructuredTextsRef.current.delete(localPath);
        return;
      }

      ocrTextsRef.current.set(localPath, text);
      const structured = reconstructLayout(rawBlocks);
      ocrStructuredTextsRef.current.set(localPath, structured || text);
      const combinedText = Array.from(ocrTextsRef.current.values()).join('\n\n---\n\n');
      const structuredCombined = Array.from(ocrStructuredTextsRef.current.values()).join(
        '\n\n---\n\n'
      );
      setLiveOcrText(combinedText);

      const detectedType = detectDocumentType(text);
      if (
        detectedType &&
        detectedType !== 'altul' &&
        detectedType !== 'custom' &&
        visibleDocTypes.includes(detectedType)
      ) {
        setType(detectedType);
        setCustomTypeId(null);
        setMetadata({});
      }

      const info = extractDocumentInfo(text);
      const docType = detectedType ?? type;
      const extracted = extractFieldsForType(docType, text);

      // Dacă auto-detecția a schimbat tipul, extrage și câmpurile pentru tipul selectat de user
      // ca să nu rămână câmpuri predefinite goale (ex: VIN la carte_auto)
      const finalMeta: Record<string, string> =
        detectedType && detectedType !== type
          ? { ...extractFieldsForType(type, text).metadata, ...extracted.metadata }
          : extracted.metadata;

      if (Object.keys(finalMeta).length > 0) {
        setMetadata(prev => ({ ...finalMeta, ...prev }));
      }
      if (extracted.expiry_date) {
        setExpiryDate(extracted.expiry_date);
        expiryDateRef.current = extracted.expiry_date;
      } else if (
        info.expiry_date &&
        !expiryDateRef.current &&
        docType !== 'talon' &&
        docType !== 'carte_auto'
      ) {
        // talon și carte_auto nu au dată de expirare proprie — evităm să punem data greșită
        setExpiryDate(info.expiry_date);
        expiryDateRef.current = info.expiry_date;
      }
      if (extracted.issue_date) {
        setIssueDate(extracted.issue_date);
        issueDateRef.current = extracted.issue_date;
      } else if (info.issue_date && !issueDateRef.current) {
        setIssueDate(info.issue_date);
        issueDateRef.current = info.issue_date;
      }

      const summary = formatOcrSummary(text, info);
      if (summary && !note) {
        setNote(summary);
      }

      // Re-declanșează AI ori de câte ori textul combinat crește cu cel puțin 80 de caractere.
      // Astfel, documentele multi-pagină (ex: talon + ANEXA) primesc o analiză completă
      // și nu se blochează la textul parțial al primei pagini.
      const trimmedLen = combinedText.trim().length;
      if (trimmedLen > 20 && trimmedLen > lastAiTextLengthRef.current + 80) {
        lastAiTextLengthRef.current = trimmedLen;
        void runAiOcrMapper(structuredCombined);
      }

      // Reminder-ul pentru dată expirare se oferă la Salvează (cu data finală după AI)
    } catch {
      // OCR opțional
    } finally {
      if (!skipLoadingState) setOcrLoading(false);
    }
  }

  async function runAiOcrMapper(combinedOcrText: string) {
    const consent = await AsyncStorage.getItem(AI_CONSENT_KEY);
    if (consent !== 'true') return;

    setAiOcrLoading(true);
    try {
      const availableEntities: AvailableEntities = {
        persons: persons.map(p => ({ id: p.id, name: p.name })),
        vehicles: vehicles.map(v => ({ id: v.id, name: v.name })),
        properties: properties.map(p => ({ id: p.id, name: p.name })),
        cards: cards.map(c => ({ id: c.id, nickname: c.nickname, last4: c.last4 })),
        animals: animals.map(a => ({ id: a.id, name: a.name, species: a.species })),
        companies: companies.map(c => ({ id: c.id, name: c.name })),
      };

      const result = await mapOcrWithAi(combinedOcrText, availableEntities);

      // Aplică tipul documentului dacă AI-ul l-a detectat și e vizibil
      if (
        result.documentType &&
        result.documentType !== 'altul' &&
        result.documentType !== 'custom' &&
        visibleDocTypes.includes(result.documentType)
      ) {
        setType(result.documentType);
        setCustomTypeId(null);
        setMetadata({});
      }

      // Aplică câmpurile — AI-ul suprascrie câmpurile locale
      if (Object.keys(result.fields).length > 0) {
        setMetadata(prev => ({ ...prev, ...result.fields }));
      }

      // Aplică datele — AI-ul are prioritate față de extracția locală
      const noExpiryTypes: string[] = [
        'carte_auto',
        'analize_medicale',
        'cadastru',
        'act_proprietate',
      ];
      const effectiveType = result.documentType ?? type;
      if (result.expiryDate && !noExpiryTypes.includes(effectiveType)) {
        setExpiryDate(result.expiryDate);
        expiryDateRef.current = result.expiryDate;
      } else if (effectiveType === 'talon' && result.fields.itp_expiry_date && !result.expiryDate) {
        // Fallback: AI a pus data ITP în fields dar nu în expiryDate — convertim ZZ.LL.AAAA → YYYY-MM-DD
        const m = result.fields.itp_expiry_date.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        if (m) {
          const isoDate = `${m[3]}-${m[2]}-${m[1]}`;
          setExpiryDate(isoDate);
          expiryDateRef.current = isoDate;
        }
      }
      if (result.issueDate) {
        setIssueDate(result.issueDate);
        issueDateRef.current = result.issueDate;
      }

      // Aplică prima sugestie de entitate cu confidence high sau medium
      const topSuggestion = result.entitySuggestions.find(
        s => s.confidence === 'high' || s.confidence === 'medium'
      );
      if (topSuggestion) {
        const alreadyLinked = entityLinks.some(
          l => l.entityType === topSuggestion.entityType && l.entityId === topSuggestion.entityId
        );
        if (!alreadyLinked) {
          setEntityLinks(prev => [
            ...prev,
            { entityType: topSuggestion.entityType, entityId: topSuggestion.entityId },
          ]);
          setPickerCategory(topSuggestion.entityType);
        }
      }

      setAiOcrApplied(true);
    } catch (e) {
      // Eroarea de limită AI sau de rețea — nu blocăm utilizatorul, OCR local rămâne valid
      const msg = e instanceof Error ? e.message : 'Eroare AI';
      if (msg.includes('limita')) {
        Alert.alert('Limită AI atinsă', msg, [{ text: 'OK' }]);
      }
      // Alte erori sunt silențioase (OCR local deja aplicat)
    } finally {
      setAiOcrLoading(false);
    }
  }

  async function handleManualOcr() {
    if (pages.length === 0) return;
    setAiOcrApplied(false);
    lastAiTextLengthRef.current = 0;
    setOcrLoading(true);
    try {
      for (const page of pages) {
        if (isPdfFile(page.localPath)) {
          // ML Kit nu suportă PDF — încearcă extracție text
          const text = await extractTextFromPdf(page.localPath);
          const pdfText = text.trim();
          const pdfDisplay = pdfText || '[PDF atașat – fișier tip imagine/scan, fără text extras]';
          ocrTextsRef.current.set(page.localPath, pdfDisplay);
          ocrStructuredTextsRef.current.set(page.localPath, pdfDisplay);
        } else {
          await runOcrOnImage(page.localPath, true);
        }
      }
      const combined = Array.from(ocrTextsRef.current.values()).join('\n\n---\n\n');
      const structuredCombined = Array.from(ocrStructuredTextsRef.current.values()).join(
        '\n\n---\n\n'
      );
      setLiveOcrText(combined);
      // Trimite la AI pentru cross-validare și completare câmpuri (dacă consent dat)
      if (combined.trim().length > 20) {
        void runAiOcrMapper(structuredCombined);
      }
    } finally {
      setOcrLoading(false);
    }
  }

  // ── Photo management ──────────────────────────────────────────────────────

  function handleDeletePage(pageId: string) {
    setPages(prev => prev.filter(p => p.localPath !== pageId));
    ocrTextsRef.current.delete(pageId);
    ocrStructuredTextsRef.current.delete(pageId);
    setLiveOcrText(Array.from(ocrTextsRef.current.values()).join('\n\n---\n\n'));
  }

  async function handleRotate(pageId: string, degrees: number) {
    const page = pages.find(p => p.localPath === pageId);
    if (!page) return;
    try {
      const rotated = await ImageManipulator.manipulateAsync(
        page.localPath,
        [{ rotate: degrees }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
      );
      await FileSystem.copyAsync({ from: rotated.uri, to: page.localPath });
      setPages(prev => {
        const next = [...prev];
        const idx = next.findIndex(p => p.localPath === pageId);
        if (idx !== -1) next[idx] = { ...next[idx], uri: rotated.uri };
        return next;
      });
      ocrTextsRef.current.delete(pageId);
      ocrStructuredTextsRef.current.delete(pageId);
      setAiOcrApplied(false);
      runOcrOnImage(page.localPath);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut roti imaginea');
    }
  }

  async function pickPdf() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) return;

      const filename = `doc_${Date.now()}.pdf`;
      const dir = `${FileSystem.documentDirectory}documents`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const dest = `${dir}/${filename}`;
      await FileSystem.copyAsync({ from: asset.uri, to: dest });

      // Adăugăm PDF-ul ca pagină (uri = dest pentru compatibilitate)
      setPages(prev => [...prev, { uri: dest, localPath: dest }]);

      // Extragere text din PDF
      setOcrLoading(true);
      try {
        const text = await extractTextFromPdf(dest);
        const pdfText = text.trim();
        // Chiar dacă PDF-ul nu are text (scan), marcăm că există un PDF atașat
        const displayText = pdfText || '[PDF atașat – fișier tip imagine/scan, fără text extras]';
        ocrTextsRef.current.set(dest, displayText);
        ocrStructuredTextsRef.current.set(dest, displayText);
        setLiveOcrText(Array.from(ocrTextsRef.current.values()).join('\n\n---\n\n'));
        if (pdfText) {
          if (pdfText.length < 100) {
            Alert.alert(
              'PDF scanat',
              'PDF-ul pare a fi o scanare – textul extras este limitat. Poți folosi OCR manual pe imaginile atașate.'
            );
          }
          const detectedType = detectDocumentType(text);
          if (
            detectedType &&
            detectedType !== 'altul' &&
            detectedType !== 'custom' &&
            visibleDocTypes.includes(detectedType)
          ) {
            setType(detectedType);
            setCustomTypeId(null);
            setMetadata({});
          }
          const info = extractDocumentInfo(text);
          const fields = extractFieldsForType(detectedType ?? type, text);
          if (Object.keys(fields.metadata).length > 0) {
            setMetadata(prev => ({ ...fields.metadata, ...prev }));
          }
          if (fields.expiry_date && !expiryDateRef.current) {
            setExpiryDate(fields.expiry_date);
            expiryDateRef.current = fields.expiry_date;
          } else if (info.expiry_date && !expiryDateRef.current) {
            setExpiryDate(info.expiry_date);
            expiryDateRef.current = info.expiry_date;
          }
          if (fields.issue_date && !issueDateRef.current) {
            setIssueDate(fields.issue_date);
            issueDateRef.current = fields.issue_date;
          } else if (info.issue_date && !issueDateRef.current) {
            setIssueDate(info.issue_date);
            issueDateRef.current = info.issue_date;
          }
          // Trimite la AI (PDF are text deja disponibil)
          const allStructured = Array.from(ocrStructuredTextsRef.current.values()).join(
            '\n\n---\n\n'
          );
          if (allStructured.trim().length > 20) {
            void runAiOcrMapper(allStructured);
          }
        }
      } catch {
        // Extracția text a eșuat — continuăm fără text
      } finally {
        setOcrLoading(false);
      }
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut selecta PDF-ul');
    }
  }

  function handleAddPage() {
    Alert.alert('Adaugă atașament', '', [
      { text: 'Cameră', onPress: takePhoto },
      { text: 'Galerie', onPress: pickImage },
      { text: 'Adaugă PDF', onPress: pickPdf },
      { text: 'Anulare', style: 'cancel' },
    ]);
  }

  async function processAndSaveImage(uri: string, optimize: boolean, exifOrientation?: number) {
    try {
      let finalUri = uri;

      if (exifOrientation && exifOrientation !== 1) {
        let rotationDegrees = 0;
        if (exifOrientation === 3) rotationDegrees = 180;
        else if (exifOrientation === 6) rotationDegrees = 90;
        else if (exifOrientation === 8) rotationDegrees = -90;

        if (rotationDegrees !== 0) {
          const rotated = await ImageManipulator.manipulateAsync(
            finalUri,
            [{ rotate: rotationDegrees }],
            { compress: 1, format: ImageManipulator.SaveFormat.JPEG }
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
      runOcrOnImage(dest);
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
      quality: 1,
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
      quality: 1,
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

  // ── Validare ─────────────────────────────────────────────────────────────

  const hasAnyField =
    issueDate.trim() !== '' ||
    expiryDate.trim() !== '' ||
    note.trim() !== '' ||
    Object.values(metadata).some(v => v.trim() !== '') ||
    entityLinks.length > 0;

  const canSave = pages.length > 0 || hasAnyField;

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (duplicateDoc) {
      const typeName = DOCUMENT_TYPE_LABELS[duplicateDoc.type] ?? duplicateDoc.type;
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Document similar există',
          `Există deja un document de tip „${typeName}" pentru această entitate. Ce vrei să faci?`,
          [
            { text: 'Anulare', style: 'cancel', onPress: () => resolve(false) },
            {
              text: 'Deschide existentul',
              onPress: () => {
                router.push(`/(tabs)/documente/${duplicateDoc.id}`);
                resolve(false);
              },
            },
            { text: 'Salvează oricum', onPress: () => resolve(true) },
          ]
        );
      });
      if (!confirmed) return;
    }

    setLoading(true);
    try {
      const newDoc = await createDocument({
        type,
        custom_type_id: type === 'custom' ? (customTypeId ?? undefined) : undefined,
        issue_date: issueDateRef.current.trim() || undefined,
        expiry_date: !HIDE_EXPIRY_TYPES.includes(type)
          ? expiryDateRef.current.trim() || undefined
          : undefined,
        note: note.trim() || undefined,
        file_path: pages[0]?.localPath ? toRelativePath(pages[0].localPath) : undefined,
        person_id: entityLinks.find(l => l.entityType === 'person')?.entityId,
        property_id: entityLinks.find(l => l.entityType === 'property')?.entityId,
        vehicle_id: entityLinks.find(l => l.entityType === 'vehicle')?.entityId,
        card_id: entityLinks.find(l => l.entityType === 'card')?.entityId,
        animal_id: entityLinks.find(l => l.entityType === 'animal')?.entityId,
        company_id: entityLinks.find(l => l.entityType === 'company')?.entityId,
        extra_entity_links: entityLinks.length > 0 ? entityLinks : undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        auto_delete: autoDelete ?? undefined,
        ocr_text:
          Array.from(ocrStructuredTextsRef.current.values()).filter(Boolean).join('\n\n---\n\n') ||
          undefined,
      });
      const { addDocumentPage } = await import('@/services/documents');
      for (let i = 1; i < pages.length; i++) {
        await addDocumentPage(newDoc.id, toRelativePath(pages[i].localPath));
      }
      await refresh();
      scheduleExpirationReminders().catch(() => {});

      const finalExpiry = expiryDateRef.current.trim();
      if (finalExpiry && isCalendarAvailable()) {
        const linkedVehicleId = entityLinks.find(l => l.entityType === 'vehicle')?.entityId;
        const linkedPersonId = entityLinks.find(l => l.entityType === 'person')?.entityId;
        const linkedPropertyId = entityLinks.find(l => l.entityType === 'property')?.entityId;
        const entityName =
          (linkedPersonId && persons.find(p => p.id === linkedPersonId)?.name) ||
          (linkedVehicleId && vehicles.find(v => v.id === linkedVehicleId)?.name) ||
          (linkedPropertyId && properties.find(p => p.id === linkedPropertyId)?.name) ||
          undefined;
        setLoading(false);
        Alert.alert(
          'Adaugă în calendar?',
          `Vrei să adaugi un reminder în calendar pentru expirarea pe ${finalExpiry}?`,
          [
            { text: 'Nu', style: 'cancel', onPress: () => router.replace('/(tabs)/documente') },
            {
              text: 'Adaugă',
              onPress: async () => {
                const id = await addExpiryCalendarEvent({
                  docType: type,
                  expiryDate: finalExpiry,
                  entityName,
                  documentId: newDoc.id,
                  note: note.trim() || undefined,
                });
                if (!id)
                  Alert.alert(
                    'Eroare',
                    'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.'
                  );
                router.replace('/(tabs)/documente');
              },
            },
          ]
        );
        return;
      }

      if (type === 'bilet' && metadata.event_date && isCalendarAvailable()) {
        const title =
          [metadata.categorie, metadata.venue].filter(Boolean).join(' – ') || 'Eveniment';
        setLoading(false);
        Alert.alert(
          'Adaugă în calendar?',
          `Vrei reminder pentru evenimentul din ${metadata.event_date}?`,
          [
            { text: 'Nu', style: 'cancel', onPress: () => router.replace('/(tabs)/documente') },
            {
              text: 'Adaugă',
              onPress: async () => {
                await addEventToCalendar({
                  title,
                  eventDate: metadata.event_date,
                  venue: metadata.venue,
                  note: note.trim() || undefined,
                  documentId: newDoc.id,
                });
                router.replace('/(tabs)/documente');
              },
            },
          ]
        );
        return;
      }

      router.replace('/(tabs)/documente');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva');
    } finally {
      setLoading(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const pickerEntities: { id: string; label: string }[] =
    pickerCategory === 'person'
      ? persons.map(p => ({ id: p.id, label: p.name }))
      : pickerCategory === 'property'
        ? properties.map(p => ({ id: p.id, label: p.name }))
        : pickerCategory === 'vehicle'
          ? vehicles.map(v => ({ id: v.id, label: v.name }))
          : pickerCategory === 'animal'
            ? animals.map(a => ({ id: a.id, label: a.name }))
            : pickerCategory === 'company'
              ? companies.map(c => ({ id: c.id, label: c.name }))
              : cards.map(c => ({ id: c.id, label: c.nickname }));

  function toggleEntityLink(id: string) {
    setEntityLinks(prev => {
      const exists = prev.some(l => l.entityType === pickerCategory && l.entityId === id);
      if (exists) return prev.filter(l => !(l.entityType === pickerCategory && l.entityId === id));
      return [...prev, { entityType: pickerCategory, entityId: id }];
    });
  }

  function getEntityDisplayName(link: DocumentEntityLink): string {
    switch (link.entityType) {
      case 'person':
        return persons.find(p => p.id === link.entityId)?.name ?? link.entityId;
      case 'vehicle':
        return vehicles.find(v => v.id === link.entityId)?.name ?? link.entityId;
      case 'property':
        return properties.find(p => p.id === link.entityId)?.name ?? link.entityId;
      case 'card':
        return cards.find(c => c.id === link.entityId)?.nickname ?? link.entityId;
      case 'animal':
        return animals.find(a => a.id === link.entityId)?.name ?? link.entityId;
      case 'company':
        return companies.find(c => c.id === link.entityId)?.name ?? link.entityId;
    }
  }

  const anyEntitySelected = entityLinks.length > 0;

  const visibleStandardTypes = ALL_STANDARD_TYPES.filter(({ value }) =>
    visibleDocTypes.includes(value)
  );

  const hasHiddenTypes = ALL_STANDARD_TYPES.length > visibleStandardTypes.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Adaugă document',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingRight: 8 }}>
              <Text style={{ color: primary, fontSize: 16 }}>Înapoi</Text>
            </Pressable>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: C.background }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={[styles.scroll, { backgroundColor: C.background }]}
          contentContainerStyle={styles.scrollContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={true}
        >
          {/* 1. POZE & OCR */}
          <Text style={[styles.label, styles.sectionLabel]}>Poze / scan</Text>
          <DocumentPhotoSection
            pages={photoPages}
            ocrLoading={ocrLoading || aiOcrLoading}
            ocrText={liveOcrText || undefined}
            onAddPage={handleAddPage}
            onRotate={handleRotate}
            onDelete={handleDeletePage}
            onRunOcr={handleManualOcr}
            onFullscreen={setFullscreenUri}
          />
          {aiOcrApplied && (
            <View style={[styles.aiBadge, { backgroundColor: C.primaryMuted ?? '#f0f5e8' }]}>
              <Text style={[styles.aiBadgeText, { color: primary }]}>
                ✦ Câmpuri completate cu AI · Verifică înainte de salvare
              </Text>
            </View>
          )}
          {aiOcrLoading && (
            <Text style={[styles.aiLoadingText, { color: C.textSecondary }]}>
              Analizez cu AI...
            </Text>
          )}
          {aiConsentAvailable && liveOcrText.trim().length > 20 && !aiOcrLoading && (
            <Pressable
              style={({ pressed }) => [
                styles.aiManualBtn,
                { borderColor: primary, opacity: pressed ? 0.75 : 1 },
              ]}
              onPress={() => {
                setAiOcrApplied(false);
                void runAiOcrMapper(liveOcrText);
              }}
            >
              <Text style={[styles.aiManualBtnText, { color: primary }]}>
                {aiOcrApplied ? '↺ Re-analizează cu AI' : '✦ Analizează cu AI'}
              </Text>
            </Pressable>
          )}

          {/* DUPLICAT */}
          {duplicateDoc && (
            <Pressable
              style={styles.duplicateBanner}
              onPress={() => router.push(`/(tabs)/documente/${duplicateDoc.id}`)}
            >
              <Text style={styles.duplicateBannerTitle}>Document similar găsit</Text>
              <Text style={styles.duplicateBannerBody}>
                Există deja un document de tip „
                {DOCUMENT_TYPE_LABELS[duplicateDoc.type] ?? duplicateDoc.type}" pentru această
                entitate.
              </Text>
              <Text style={styles.duplicateBannerLink}>Deschide documentul existent →</Text>
            </Pressable>
          )}

          {/* 2. TIP DOCUMENT */}
          <Text style={styles.label}>Tip document</Text>
          <Pressable style={styles.typeToggleRow} onPress={() => setTypePickerVisible(v => !v)}>
            <Text style={styles.typeToggleCurrent}>
              {type === 'custom'
                ? (customTypes.find(c => c.id === customTypeId)?.name ?? 'Tip personalizat')
                : (DOCUMENT_TYPE_LABELS[type] ?? type)}
            </Text>
            <Text style={styles.typeToggleChevron}>{typePickerVisible ? '▲' : '▼ Schimbă'}</Text>
          </Pressable>
          {typePickerVisible && (
            <>
              {hasHiddenTypes && (
                <Pressable onPress={() => router.push('/(tabs)/setari')} style={styles.showAllBtn}>
                  <Text style={[styles.showAllBtnText, { color: '#888' }]}>
                    Alte tipuri (dezactivate în Setări) →
                  </Text>
                </Pressable>
              )}
              <View style={styles.typeRow}>
                {visibleStandardTypes.map(({ value, label }) => (
                  <Pressable
                    key={value}
                    style={[styles.typeChip, type === value && styles.typeChipActive]}
                    onPress={() => {
                      const combinedText = Array.from(ocrTextsRef.current.values()).join(
                        '\n\n---\n\n'
                      );
                      setType(value);
                      setCustomTypeId(null);
                      setMetadata({});
                      if (combinedText.trim().length > 0) {
                        const extracted = extractFieldsForType(value, combinedText);
                        if (Object.keys(extracted.metadata).length > 0) {
                          setMetadata(extracted.metadata);
                        }
                      }
                      setTypePickerVisible(false);
                    }}
                  >
                    <Text
                      style={[styles.typeChipText, type === value && styles.typeChipTextActive]}
                    >
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
                    onPress={() => {
                      setType('custom');
                      setCustomTypeId(ct.id);
                      setMetadata({});
                      setTypePickerVisible(false);
                    }}
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
            </>
          )}

          {/* 3. CÂMPURI SPECIFICE TIPULUI */}
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

          {/* 4. DATE */}
          <DatePickerField
            label="Data emisiune (opțional)"
            value={issueDate}
            onChange={v => {
              issueDateRef.current = v;
              setIssueDate(v);
            }}
            disabled={loading}
          />
          {!HIDE_EXPIRY_TYPES.includes(type) && (
            <DatePickerField
              label={CUSTOM_EXPIRY_LABEL[type] ?? 'Data expirare (opțional)'}
              value={expiryDate}
              onChange={v => {
                expiryDateRef.current = v;
                setExpiryDate(v);
              }}
              disabled={loading}
            />
          )}
          {expiryDate && !HIDE_EXPIRY_TYPES.includes(type) ? (
            <Pressable
              style={styles.calendarInlineBtn}
              onPress={async () => {
                if (!isCalendarAvailable()) {
                  Alert.alert('Calendar indisponibil', 'Necesită build nativ (expo run:ios).');
                  return;
                }
                const id = await addExpiryCalendarEvent({
                  docType: type,
                  expiryDate,
                  entityName: undefined,
                  note: note.trim() || undefined,
                });
                if (!id)
                  Alert.alert(
                    'Eroare',
                    'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.'
                  );
                else Alert.alert('Calendar', 'Reminder adăugat în calendar.');
              }}
            >
              <Text style={styles.calendarInlineBtnText}>📅 Adaugă reminder în calendar</Text>
            </Pressable>
          ) : null}

          {/* 5. AUTO-ȘTERGERE */}
          <Text style={styles.label}>Auto-ștergere (opțional)</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            style={styles.chipsScroll}
          >
            {(
              [
                ...(expiryDate ? [{ label: 'La expirare', value: 'expiry' }] : []),
                { label: 'Niciodată', value: null },
                { label: '30 zile', value: '30d' },
                { label: '90 zile', value: '90d' },
                { label: '180 zile', value: '180d' },
                { label: '1 an', value: '365d' },
              ] as { label: string; value: string | null }[]
            ).map(opt => (
              <Pressable
                key={opt.value ?? 'never'}
                style={[styles.typeChip, autoDelete === opt.value && styles.typeChipActive]}
                onPress={() => setAutoDelete(opt.value)}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    autoDelete === opt.value && styles.typeChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* 6. NOTĂ */}
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

          {/* 7. LEAGĂ DE ENTITATE */}
          <>
            <Text style={[styles.label, styles.sectionLabel]}>
              Leagă de entitate
              {anyEntitySelected ? (
                <Text style={{ color: primary }}>
                  {' '}
                  · {entityLinks.length} {entityLinks.length === 1 ? 'selectată' : 'selectate'}
                </Text>
              ) : (
                <Text style={{ opacity: 0.5 }}> (opțional)</Text>
              )}
            </Text>

            {/* Rezumat entități selectate */}
            {anyEntitySelected && (
              <Text style={[styles.entitySummary, { color: C.textSecondary }]} numberOfLines={2}>
                {entityLinks.map(l => getEntityDisplayName(l)).join('  ·  ')}
              </Text>
            )}

            {/* Taburi categorii cu badge */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.categoryRow}
              contentContainerStyle={styles.categoryRowContent}
            >
              {ENTITY_CATEGORIES.filter(cat => visibleEntityTypes.includes(cat.key)).map(
                ({ key, label }) => {
                  const countInCat = entityLinks.filter(l => l.entityType === key).length;
                  return (
                    <Pressable
                      key={key}
                      style={[
                        styles.categoryTab,
                        pickerCategory === key && styles.categoryTabActive,
                      ]}
                      onPress={() => setPickerCategory(key)}
                    >
                      <Text
                        style={[
                          styles.categoryTabText,
                          pickerCategory === key && styles.categoryTabTextActive,
                        ]}
                      >
                        {label}
                        {countInCat > 0 ? ` (${countInCat})` : ''}
                      </Text>
                    </Pressable>
                  );
                }
              )}
            </ScrollView>

            {/* Entități ca chips — tap = toggle selectare */}
            {pickerEntities.length === 0 ? (
              <Text style={styles.pickerEmpty}>Nicio entitate adăugată.</Text>
            ) : (
              <View style={styles.entityChipsWrap}>
                {pickerEntities.map(e => {
                  const isSelected = entityLinks.some(
                    l => l.entityType === pickerCategory && l.entityId === e.id
                  );
                  return (
                    <Pressable
                      key={e.id}
                      style={[styles.entityChipItem, isSelected && styles.entityChipItemActive]}
                      onPress={() => toggleEntityLink(e.id)}
                    >
                      <Text
                        style={[styles.entityChipLabel, isSelected && styles.entityChipLabelActive]}
                      >
                        {isSelected ? `✓ ${e.label}` : e.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </>
        </ScrollView>
        <BottomActionBar
          label="Salvează"
          onPress={handleSubmit}
          loading={loading}
          disabled={!canSave}
          safeArea
        />
      </KeyboardAvoidingView>

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
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 48 },
  linked: { fontSize: 14, opacity: 0.8, marginBottom: 16 },
  label: { fontSize: 14, marginBottom: 6, opacity: 0.9 },
  sectionLabel: { marginTop: 8, fontSize: 15, fontWeight: '600', opacity: 1 },
  aiBadge: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  aiBadgeText: { fontSize: 13, fontWeight: '600' },
  aiLoadingText: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  aiManualBtn: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  aiManualBtnText: { fontSize: 13, fontWeight: '600' },
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
  entitySummary: { fontSize: 12, marginBottom: 10, marginTop: -2 },
  entityChipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  entityChipItem: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  entityChipItemActive: { backgroundColor: primary, borderColor: primary },
  entityChipLabel: { fontSize: 14 },
  entityChipLabelActive: { color: '#fff', fontWeight: '500' as const },
  pickerEmpty: { opacity: 0.6, fontSize: 14, marginBottom: 20 },
  chipsScroll: { marginBottom: 20 },
  chipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  // Submit
  button: {
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonPressed: { opacity: 0.9 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600', textAlign: 'center' },
  calendarInlineBtn: {
    alignSelf: 'flex-start',
    marginTop: -12,
    marginBottom: 20,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: primary,
  },
  calendarInlineBtnText: {
    fontSize: 13,
    color: primary,
    fontWeight: '500',
  },
  typeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  typeToggleCurrent: { fontSize: 15, fontWeight: '500', flex: 1 },
  typeToggleChevron: { fontSize: 13, color: primary, fontWeight: '500' },
  showAllBtn: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  showAllBtnText: {
    color: primary,
    fontSize: 13,
    fontWeight: '500',
  },
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
  duplicateBanner: {
    backgroundColor: '#fff8e1',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  duplicateBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 4,
  },
  duplicateBannerBody: {
    fontSize: 13,
    color: '#78350f',
    marginBottom: 6,
  },
  duplicateBannerLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#b45309',
  },
});
