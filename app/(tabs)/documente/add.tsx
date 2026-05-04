import { useRef, useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
  Platform,
  Modal,
  StatusBar,
  useWindowDimensions,
  InteractionManager,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { extractTextFromPdf, isPdfFile } from '@/services/pdfExtractor';
import { renderPdfFirstPageForVision } from '@/services/pdfOcr';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { FormPageScreen } from '@/components/ui/FormPageScreen';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary, statusColors, sensitive, sensitiveBorder, sensitiveBg } from '@/theme/colors';
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
import { extractFieldsForType, isKnownUtilitySupplier } from '@/services/ocrExtractors';
import { reconstructLayout } from '@/services/ocrLayout';
import { toRelativePath } from '@/services/fileUtils';
import {
  getDocumentsByEntity,
  findDuplicateDocument,
  updateDocument,
  getVehicleIdentifiers,
  setDocumentCalendarEventId,
} from '@/services/documents';
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
import { AI_CONSENT_KEY } from '@/services/aiProvider';
import * as ocrConsent from '@/services/ocrConsent';
import { extractFieldsWithLlm } from '@/services/ocrLlmExtractor';
import { scanDocumentPages } from '@/services/documentScanner';

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
  factura: 'Scadență (pentru reminder)',
};

const ENTITY_CATEGORIES: { key: EntityType; label: string }[] = [
  { key: 'person', label: 'Persoană' },
  { key: 'property', label: 'Proprietate' },
  { key: 'vehicle', label: 'Vehicul' },
  { key: 'card', label: 'Card' },
  { key: 'animal', label: 'Animal' },
  { key: 'company', label: 'Firmă' },
];

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
  const headerHeight = useHeaderHeight();
  const { customTypes } = useCustomTypes();
  const { visibleDocTypes, visibleEntityTypes } = useVisibilitySettings();

  const [type, setType] = useState<DocumentType>((params.type as DocumentType) || 'altul');
  const [customTypeId, setCustomTypeId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, string>>({});
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const expiryDateRef = useRef('');
  const issueDateRef = useRef('');
  const [note, setNote] = useState('');
  const [privateNotes, setPrivateNotes] = useState('');
  const [autoDelete, setAutoDelete] = useState<string | null>(null);
  const [pages, setPages] = useState<{ uri: string; localPath: string }[]>([]);
  const ocrTextsRef = useRef<Map<string, string>>(new Map());
  const ocrStructuredTextsRef = useRef<Map<string, string>>(new Map());
  const [liveOcrText, setLiveOcrText] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [aiOcrLoading, setAiOcrLoading] = useState(false);
  const [aiOcrApplied, setAiOcrApplied] = useState(false);
  const [llmFieldLoading, setLlmFieldLoading] = useState(false);
  const lastAiTextLengthRef = useRef(0);
  const [textAiConsentAvailable, setTextAiConsentAvailable] = useState(false);
  const [duplicateDoc, setDuplicateDoc] = useState<Document | null>(null);
  const [suggestedInactiveType, setSuggestedInactiveType] = useState<DocumentType | null>(null);
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(AI_CONSENT_KEY).then(v => setTextAiConsentAvailable(v === 'true'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        return;
      }
      setPhotoRefreshKey(k => k + 1);
    }, [])
  );

  const [fullscreenUri, setFullscreenUri] = useState<string | null>(null);
  const [typePickerVisible, setTypePickerVisible] = useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // Entity picker state
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
  const [pickerCategory, setPickerCategory] = useState<EntityType>(
    () => entityLinks[0]?.entityType ?? 'person'
  );

  // Auto-comută tab-ul picker-ului pe primul tip de entitate legat, dacă tab-ul
  // curent e gol și există legături pe alt tip. Respectă alegerea manuală:
  // dacă user-ul e deja pe un tab cu entități legate, nu schimbă nimic.
  useEffect(() => {
    if (entityLinks.length === 0) return;
    const currentTabHasLinks = entityLinks.some(l => l.entityType === pickerCategory);
    if (!currentTabHasLinks) {
      setPickerCategory(entityLinks[0].entityType);
    }
  }, [entityLinks, pickerCategory]);

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

  // ── Entity fuzzy match local ──────────────────────────────────────────────
  // Fallback când AI-ul nu sugerează nicio entitate: caută simplul subșir al
  // numelui entității (normalizat fără diacritice) în textul OCR.

  function tryLocalEntityMatch(ocrText: string) {
    // Nu suprascrie legăturile existente
    if (entityLinks.length > 0) return;

    const norm = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const normOcr = norm(ocrText);

    type Candidate = { entityType: EntityType; entityId: string; score: number };
    const candidates: Candidate[] = [];

    const check = (etype: EntityType, items: { id: string; name: string }[]) => {
      for (const item of items) {
        const normName = norm(item.name);
        if (normName.length < 2) continue;
        if (normOcr.includes(normName)) {
          // Scor = lungimea numelui (evităm false-positive pe nume scurte)
          candidates.push({ entityType: etype, entityId: item.id, score: normName.length });
        }
      }
    };

    check('person', persons);
    check('vehicle', vehicles);
    check('property', properties);
    check('animal', animals);
    check('company', companies);

    if (candidates.length === 0) return;
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    // Minim 3 caractere ca să evităm potriviri accidentale pe silabe
    if (best.score < 3) return;

    setEntityLinks(prev => {
      if (prev.some(l => l.entityType === best.entityType && l.entityId === best.entityId))
        return prev;
      return [...prev, { entityType: best.entityType, entityId: best.entityId }];
    });
    setPickerCategory(best.entityType);
  }

  // ── OCR ──────────────────────────────────────────────────────────────────

  async function runOcrOnImage(localPath: string, skipLoadingState = false) {
    if (!skipLoadingState) setOcrLoading(true);
    try {
      let { text, rawBlocks } = await extractText(localPath);

      // Încearcă mereu toate cele 3 rotații și alege orientarea cu cel mai mult text.
      // Verificarea threshold-ului (< 50 chars) era insuficientă: Vision pe iOS modern
      // poate extrage ≥50 de caractere chiar și din imagini rotite greșit.
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
      setLiveOcrText(structuredCombined);

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
      if (summary) {
        setNote(prev => prev || summary);
      }

      // Preset auto-ștergere 5 ani pentru facturi furnizori utilități (OCR local)
      const localSupplier = finalMeta.supplier ?? '';
      if (docType === 'factura' && localSupplier && isKnownUtilitySupplier(localSupplier)) {
        setAutoDelete(prev => (prev === null ? '1825d' : prev));
      }

      // Re-declanșează AI (text) ori de câte ori textul combinat crește cu cel puțin 80 de caractere.
      const trimmedLen = combinedText.trim().length;
      if (trimmedLen > 20 && trimmedLen > lastAiTextLengthRef.current + 80) {
        lastAiTextLengthRef.current = trimmedLen;
        void runAiOcrMapper(structuredCombined);
      } else {
        tryLocalEntityMatch(combinedText);
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
    if (ocrConsent.getDocTypeSensitivity(type) === 'medical') return;

    setAiOcrLoading(true);
    try {
      // Îmbogățim contextul vehiculelor cu placa/VIN din talon/carte_auto atașate,
      // ca AI-ul să poată lega documentele și după identificatori tehnici.
      const vehicleIds = await getVehicleIdentifiers();
      const availableEntities: AvailableEntities = {
        persons: persons.map(p => ({ id: p.id, name: p.name })),
        vehicles: vehicles.map(v => {
          const ids = vehicleIds.get(v.id);
          return { id: v.id, name: v.name, plate: ids?.plate, vin: ids?.vin };
        }),
        properties: properties.map(p => ({ id: p.id, name: p.name })),
        cards: cards.map(c => ({ id: c.id, nickname: c.nickname, last4: c.last4 })),
        animals: animals.map(a => ({ id: a.id, name: a.name, species: a.species })),
        companies: companies.map(c => ({ id: c.id, name: c.name })),
      };

      // Trimite și imaginea primului fișier pentru context vizual (vision)
      let firstImageBase64: string | undefined;
      const firstPage = pages[0];
      if (firstPage) {
        try {
          if (isPdfFile(firstPage.localPath)) {
            firstImageBase64 =
              (await renderPdfFirstPageForVision(firstPage.localPath)) ?? undefined;
          } else {
            firstImageBase64 = await FileSystem.readAsStringAsync(firstPage.localPath, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }
        } catch {
          /* ignoră dacă fișierul nu poate fi citit */
        }
      }

      const result = await mapOcrWithAi(combinedOcrText, availableEntities, firstImageBase64);

      // Aplică tipul documentului dacă AI-ul l-a detectat și e vizibil
      if (
        result.documentType &&
        result.documentType !== 'altul' &&
        result.documentType !== 'custom'
      ) {
        if (visibleDocTypes.includes(result.documentType)) {
          setType(result.documentType);
          setCustomTypeId(null);
          setMetadata({});
          setSuggestedInactiveType(null);
        } else {
          setSuggestedInactiveType(result.documentType);
        }
      }

      // Aplică câmpurile — AI-ul suprascrie câmpurile locale
      if (Object.keys(result.fields).length > 0) {
        setMetadata(prev => ({ ...prev, ...result.fields }));
      }

      // Aplică nota structurată — AI-ul suprascrie mereu (inclusiv fallback-ul local)
      if (result.structuredNote) {
        setNote(result.structuredNote);
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

      // Preset auto-ștergere 5 ani pentru facturi furnizori utilități
      const effectiveDocType = result.documentType ?? type;
      const supplierField = result.fields.supplier ?? '';
      if (
        effectiveDocType === 'factura' &&
        supplierField &&
        isKnownUtilitySupplier(supplierField)
      ) {
        setAutoDelete(prev => (prev === null ? '1825d' : prev));
      }

      // Aplică prima sugestie de entitate cu confidence high sau medium.
      // Nu adăugăm o a doua entitate de același tip dacă există deja una —
      // previne dublarea când AI rulează de mai multe ori (scan multi-pagină).
      const topSuggestion = result.entitySuggestions.find(
        s => s.confidence === 'high' || s.confidence === 'medium'
      );
      if (topSuggestion) {
        const alreadyLinkedSameType = entityLinks.some(
          l => l.entityType === topSuggestion.entityType
        );
        if (!alreadyLinkedSameType) {
          setEntityLinks(prev => [
            ...prev,
            { entityType: topSuggestion.entityType, entityId: topSuggestion.entityId },
          ]);
          setPickerCategory(topSuggestion.entityType);
        }
      } else {
        // AI nu a găsit nicio entitate — fallback fuzzy local
        tryLocalEntityMatch(combinedOcrText);
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

  async function handleAiImageAnalysis() {
    if (pages.length === 0) {
      Alert.alert('Fără imagini', 'Nu există imagini sau documente atașate.');
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
      const fileNotes: string[] = [];
      const pagesToProcess = pages.slice(0, 5); // max 5 fișiere per analiză AI
      for (const page of pagesToProcess) {
        const ocrText = ocrTextsRef.current.get(page.localPath) ?? '';
        let imageBase64: string | undefined;
        try {
          if (isPdfFile(page.localPath)) {
            imageBase64 = (await renderPdfFirstPageForVision(page.localPath)) ?? undefined;
          } else {
            imageBase64 = await FileSystem.readAsStringAsync(page.localPath, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }
        } catch {}

        const extracted = await extractFieldsWithLlm(type, ocrText, imageBase64);

        if (Object.keys(extracted.metadata).length > 0) {
          setMetadata(prev => ({ ...extracted.metadata, ...prev }));
        }
        if (extracted.expiry_date && !expiryDateRef.current) {
          setExpiryDate(extracted.expiry_date);
          expiryDateRef.current = extracted.expiry_date;
        }
        if (extracted.issue_date && !issueDateRef.current) {
          setIssueDate(extracted.issue_date);
          issueDateRef.current = extracted.issue_date;
        }
        if (extracted.note) {
          fileNotes.push(extracted.note);
        }
      }

      const combined = fileNotes.join('\n___________\n');
      if (combined) setNote(combined);
    } catch {
      // LLM field extraction e opțional
    } finally {
      setLlmFieldLoading(false);
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
      setLiveOcrText(structuredCombined);
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
    setLiveOcrText(Array.from(ocrStructuredTextsRef.current.values()).join('\n\n---\n\n'));
  }

  function handleReorderPage(fromIndex: number, toIndex: number) {
    setPages(prev => {
      if (
        fromIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex < 0 ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
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
        setLiveOcrText(Array.from(ocrStructuredTextsRef.current.values()).join('\n\n---\n\n'));
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
          const summary = formatOcrSummary(pdfText, info);
          if (summary) {
            setNote(prev => prev || summary);
          }
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

  async function scanDocumentHandler() {
    try {
      const uris = await scanDocumentPages();
      if (!uris) return;
      await processAndSaveScannedPages(uris);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Scanarea a eșuat');
    }
  }

  function handleAddPage() {
    Alert.alert('Adaugă atașament', '', [
      { text: 'Scanează document', onPress: scanDocumentHandler },
      { text: 'Cameră (poză brută)', onPress: takePhoto },
      { text: 'Galerie', onPress: pickImage },
      { text: 'Adaugă PDF', onPress: pickPdf },
      { text: 'Anulare', style: 'cancel' },
    ]);
  }

  async function processAndSaveImage(uri: string, exifOrientation?: number) {
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

  async function processAndSaveScannedPages(uris: string[]) {
    if (uris.length === 0) return;
    try {
      const dir = `${FileSystem.documentDirectory}documents`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

      const batchTs = Date.now();
      const newPages: { uri: string; localPath: string }[] = [];
      for (let i = 0; i < uris.length; i++) {
        const filename = `doc_${batchTs}_${i}.jpg`;
        const dest = `${dir}/${filename}`;
        await FileSystem.copyAsync({ from: uris[i], to: dest });
        newPages.push({ uri: dest, localPath: dest });
      }

      setPages(prev => [...prev, ...newPages]);

      for (const page of newPages) {
        runOcrOnImage(page.localPath);
      }
    } catch (e) {
      Alert.alert(
        'Eroare',
        e instanceof Error ? e.message : 'Nu s-au putut salva paginile scanate'
      );
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
      await processAndSaveImage(result.assets[0].uri, exifOrientation);
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
      await processAndSaveImage(uri, exifOrientation);
    }
  }

  // ── Validare ─────────────────────────────────────────────────────────────

  const hasAnyField =
    issueDate.trim() !== '' ||
    expiryDate.trim() !== '' ||
    note.trim() !== '' ||
    privateNotes.trim() !== '' ||
    Object.values(metadata).some(v => v.trim() !== '') ||
    entityLinks.length > 0;

  const canSave = pages.length > 0 || hasAnyField;

  // ── Submit ────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    if (duplicateDoc) {
      const typeName = DOCUMENT_TYPE_LABELS[duplicateDoc.type] ?? duplicateDoc.type;
      const action = await new Promise<'save' | 'update' | null>(resolve => {
        Alert.alert(
          'Document similar există',
          `Există deja un document de tip „${typeName}" pentru această entitate. Ce vrei să faci?`,
          [
            { text: 'Anulare', style: 'cancel', onPress: () => resolve(null) },
            {
              text: 'Deschide existentul',
              onPress: () => {
                resolve(null);
                InteractionManager.runAfterInteractions(() => {
                  router.push(`/(tabs)/documente/${duplicateDoc.id}`);
                });
              },
            },
            {
              text: 'Actualizează existent',
              onPress: () => resolve('update'),
            },
            { text: 'Salvează document nou', onPress: () => resolve('save') },
          ]
        );
      });
      if (!action) return;

      if (action === 'update') {
        setLoading(true);
        try {
          const newOcrText =
            Array.from(ocrStructuredTextsRef.current.values())
              .filter(Boolean)
              .join('\n\n---\n\n') || undefined;
          await updateDocument(duplicateDoc.id, {
            type: duplicateDoc.type,
            issue_date: issueDate.trim() || duplicateDoc.issue_date || undefined,
            expiry_date: !HIDE_EXPIRY_TYPES.includes(duplicateDoc.type)
              ? expiryDate.trim() || duplicateDoc.expiry_date || undefined
              : undefined,
            note: note.trim() || duplicateDoc.note || undefined,
            file_path:
              pages.length > 0
                ? toRelativePath(pages[0].localPath)
                : (duplicateDoc.file_path ?? undefined),
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            auto_delete: autoDelete ?? duplicateDoc.auto_delete ?? undefined,
            ocr_text: newOcrText,
            private_notes: privateNotes.trim() || duplicateDoc.private_notes || undefined,
          });
          if (pages.length > 1) {
            const { addDocumentPage } = await import('@/services/documents');
            for (let i = 1; i < pages.length; i++) {
              await addDocumentPage(duplicateDoc.id, toRelativePath(pages[i].localPath));
            }
          }
          await refresh();
          router.replace(`/(tabs)/documente/${duplicateDoc.id}`);
        } catch (e) {
          Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut actualiza');
        } finally {
          setLoading(false);
        }
        return;
      }

      if (action !== 'save') return;
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
        private_notes: privateNotes.trim() || undefined,
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
                if (id) {
                  await setDocumentCalendarEventId(newDoc.id, id);
                } else {
                  Alert.alert(
                    'Eroare',
                    'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.'
                  );
                }
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
                const id = await addEventToCalendar({
                  title,
                  eventDate: metadata.event_date,
                  venue: metadata.venue,
                  note: note.trim() || undefined,
                  documentId: newDoc.id,
                });
                if (id) await setDocumentCalendarEventId(newDoc.id, id);
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
      default:
        return link.entityId;
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
      <FormPageScreen
        title="Adaugă document"
        onSave={handleSubmit}
        saving={loading}
        saveDisabled={!canSave}
        scrollContentStyle={styles.scrollContent}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {/* 1. POZE & OCR */}
        <Text style={[styles.label, styles.sectionLabel]}>Poze / scan</Text>
        <DocumentPhotoSection
          pages={photoPages}
          ocrLoading={ocrLoading || aiOcrLoading}
          ocrText={liveOcrText || undefined}
          refreshKey={photoRefreshKey}
          onAddPage={handleAddPage}
          onRotate={handleRotate}
          onDelete={handleDeletePage}
          onRunOcr={handleManualOcr}
          onFullscreen={setFullscreenUri}
          onReorderPage={handleReorderPage}
        />
        {aiOcrApplied && (
          <View style={[styles.aiBadge, { backgroundColor: C.primaryMuted ?? '#f0f5e8' }]}>
            <Text style={[styles.aiBadgeText, { color: primary }]}>
              ✦ Câmpuri completate cu AI · Verifică înainte de salvare
            </Text>
          </View>
        )}
        {(aiOcrLoading || llmFieldLoading) && (
          <View style={styles.aiLoadingRow}>
            <ActivityIndicator size="small" color={primary} style={{ marginRight: 6 }} />
            <Text style={[styles.aiLoadingText, { color: C.textSecondary }]}>
              {llmFieldLoading ? 'Analizez documentul cu AI...' : 'Analizez cu AI...'}
            </Text>
          </View>
        )}
        {textAiConsentAvailable && pages.length > 0 && !llmFieldLoading && (
          <View>
            <View style={styles.aiActionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.aiActionBtn,
                  { borderColor: '#F57F17', opacity: pressed ? 0.75 : 1 },
                ]}
                onPress={handleAiImageAnalysis}
              >
                <Text style={[styles.aiActionBtnText, { color: '#F57F17' }]}>
                  Trimite documentul la AI
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.aiActionInfo, { color: C.textSecondary }]}>
              Se trimite imaginea/PDF-ul documentului la AI pentru extragerea datelor. Acțiune
              manuală explicită.
            </Text>
          </View>
        )}

        {/* TIP INACTIV DETECTAT DE AI */}
        {suggestedInactiveType && (
          <View style={styles.inactiveBanner}>
            <Ionicons
              name="information-circle-outline"
              size={18}
              color="#E65100"
              style={{ marginRight: 8, marginTop: 1 }}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.inactiveBannerTitle}>
                AI-ul a detectat tipul „
                {DOCUMENT_TYPE_LABELS[suggestedInactiveType] ?? suggestedInactiveType}"
              </Text>
              <Text style={styles.inactiveBannerBody}>
                Acest tip nu e activat. Activează-l din Setări → Tipuri de documente vizibile.
              </Text>
              <Pressable onPress={() => router.push('/(tabs)/setari')}>
                <Text style={styles.inactiveBannerLink}>Deschide Setările →</Text>
              </Pressable>
            </View>
            <Pressable onPress={() => setSuggestedInactiveType(null)} hitSlop={8}>
              <Ionicons name="close" size={16} color="#999" />
            </Pressable>
          </View>
        )}

        {/* DUPLICAT */}
        {duplicateDoc && (
          <Pressable
            style={[
              styles.duplicateBanner,
              {
                backgroundColor:
                  scheme === 'dark' ? 'rgba(232,165,58,0.18)' : 'rgba(232,165,58,0.12)',
                borderColor: statusColors.warning,
              },
            ]}
            onPress={() => router.push(`/(tabs)/documente/${duplicateDoc.id}`)}
          >
            <Text style={[styles.duplicateBannerTitle, { color: statusColors.warning }]}>
              Document similar găsit
            </Text>
            <Text style={[styles.duplicateBannerBody, { color: C.text }]}>
              Există deja un document de tip „
              {DOCUMENT_TYPE_LABELS[duplicateDoc.type] ?? duplicateDoc.type}" pentru această
              entitate.
            </Text>
            <Text style={[styles.duplicateBannerLink, { color: statusColors.warning }]}>
              Deschide documentul existent →
            </Text>
          </Pressable>
        )}

        {/* 2. TIP DOCUMENT */}
        <Text style={styles.label}>Tip document</Text>
        <Pressable
          style={[styles.typeToggleRow, { borderColor: C.border }]}
          onPress={() => setTypePickerVisible(v => !v)}
        >
          <Text style={[styles.typeToggleCurrent, { color: C.text }]}>
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
                <Text style={[styles.showAllBtnText, { color: C.textSecondary }]}>
                  Alte tipuri (dezactivate în Setări) →
                </Text>
              </Pressable>
            )}
            <View style={styles.typeRow}>
              {visibleStandardTypes.map(({ value, label }) => {
                const active = type === value;
                return (
                  <Pressable
                    key={value}
                    style={[
                      styles.typeChip,
                      { borderColor: C.border },
                      active && styles.typeChipActive,
                    ]}
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
                      style={[
                        styles.typeChipText,
                        { color: C.text },
                        active && styles.typeChipTextActive,
                      ]}
                    >
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
                      { borderColor: C.border },
                      active && styles.typeChipActive,
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
                        { color: C.text },
                        active && styles.typeChipTextActive,
                      ]}
                    >
                      {ct.name}
                    </Text>
                  </Pressable>
                );
              })}
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
                  { borderColor: C.border },
                  active && styles.typeChipActive,
                ]}
                onPress={() => setAutoDelete(opt.value)}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    { color: C.text },
                    active && styles.typeChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* 6. NOTĂ */}
        <Text style={styles.label}>Notă (opțional)</Text>
        <ThemedTextInput
          style={[styles.input, styles.inputMultiline]}
          placeholder="Notă"
          value={note}
          onChangeText={setNote}
          multiline
          scrollEnabled
          editable={!loading}
        />

        {/* 6b. NOTĂ PRIVATĂ — nu se trimite la AI */}
        <View style={styles.privateLabelRow}>
          <Ionicons name="lock-closed" size={14} color={sensitive} />
          <Text style={[styles.label, { color: sensitive, opacity: 1 }]}>
            Notă privată (opțional)
          </Text>
        </View>
        <Text style={[styles.privateHint, { color: C.textSecondary }]}>
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
          scrollEnabled
          editable={!loading}
          secureTextEntry={false}
          autoCorrect={false}
          autoCapitalize="none"
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
                const active = pickerCategory === key;
                return (
                  <Pressable
                    key={key}
                    style={[
                      styles.categoryTab,
                      { borderColor: C.border },
                      active && styles.categoryTabActive,
                    ]}
                    onPress={() => setPickerCategory(key)}
                  >
                    <Text
                      style={[
                        styles.categoryTabText,
                        { color: C.text },
                        active && styles.categoryTabTextActive,
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
                    style={[
                      styles.entityChipItem,
                      { borderColor: C.border },
                      isSelected && styles.entityChipItemActive,
                    ]}
                    onPress={() => toggleEntityLink(e.id)}
                  >
                    <Text
                      style={[
                        styles.entityChipLabel,
                        { color: C.text },
                        isSelected && styles.entityChipLabelActive,
                      ]}
                    >
                      {isSelected ? `✓ ${e.label}` : e.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </>
      </FormPageScreen>

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
    </>
  );
}

const styles = StyleSheet.create({
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
  aiLoadingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  aiLoadingText: { fontSize: 12, fontStyle: 'italic' },
  aiActionsRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  aiActionBtn: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
  },
  aiActionBtnText: { fontSize: 13, fontWeight: '600' },
  aiActionInfo: { fontSize: 11, marginTop: 4, lineHeight: 15 },
  selectedBadge: { color: primary },
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
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  inputMultiline: { minHeight: 80, maxHeight: 180 },
  privateLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  privateHint: { fontSize: 12, marginBottom: 8, lineHeight: 16, opacity: 0.8 },
  privateInput: { borderColor: sensitiveBorder, backgroundColor: sensitiveBg },
  // Entity picker
  categoryRow: { marginBottom: 12, marginTop: 8 },
  categoryRowContent: { flexDirection: 'row', gap: 8 },
  categoryTab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
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
  },
  entityChipItemActive: { backgroundColor: primary, borderColor: primary },
  entityChipLabel: { fontSize: 14 },
  entityChipLabelActive: { color: '#fff', fontWeight: '500' as const },
  pickerEmpty: { opacity: 0.6, fontSize: 14, marginBottom: 20 },
  chipsScroll: { marginBottom: 20 },
  chipsRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
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
  inactiveBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFF3E0',
    borderColor: '#FF9800',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  inactiveBannerTitle: { fontSize: 13, fontWeight: '700', color: '#E65100', marginBottom: 3 },
  inactiveBannerBody: { fontSize: 12, color: '#BF360C', marginBottom: 4, lineHeight: 17 },
  inactiveBannerLink: { fontSize: 12, fontWeight: '600', color: '#E65100' },
  duplicateBanner: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  duplicateBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  duplicateBannerBody: {
    fontSize: 13,
    marginBottom: 6,
  },
  duplicateBannerLink: {
    fontSize: 13,
    fontWeight: '600',
  },
});
