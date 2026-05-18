import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { StyleSheet, Pressable, Alert, Platform, InteractionManager } from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
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
import { primary, primaryMuted, sensitiveBorder, sensitiveBg } from '@/theme/colors';
import { awaitCropper, makeRequestId } from '@/services/cropperBridge';
import { useDocuments } from '@/hooks/useDocuments';
import { useEntities } from '@/hooks/useEntities';
import { scheduleExpirationReminders } from '@/services/notifications';
import { addExpiryCalendarEvent, isCalendarAvailable } from '@/services/calendar';
import { promptAddExpiryReminder, promptAddEventReminder } from '@/services/calendarPrompt';
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
import {
  DOCUMENT_TYPE_LABELS,
  ENTITY_DOCUMENT_TYPES,
  ALL_ENTITY_TYPES,
  NO_EXPIRY_DOC_TYPES,
} from '@/types';
import type { Document } from '@/types';
import type { DocumentType, EntityType, DocumentEntityLink } from '@/types';
import { DatePickerField } from '@/components/DatePickerField';
import { EXPIRY_FIELD_LABEL } from '@/types/documentFields';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { useFilteredDocTypes } from '@/hooks/useFilteredDocTypes';
import { useAutoActivateDocType } from '@/hooks/useAutoActivateDocType';
import { AutoActivatedBanner } from '@/components/document/AutoActivatedBanner';
import { DuplicateBanner } from '@/components/document/DuplicateBanner';
import { AiActionsRow } from '@/components/document/AiActionsRow';
import { DocumentPhotoSection } from '@/components/DocumentPhotoSection';
import type { PhotoPage } from '@/components/DocumentPhotoSection';
import { mapOcrWithAi } from '@/services/aiOcrMapper';
import type { AvailableEntities } from '@/services/aiOcrMapper';
import { matchEntityInOcr } from '@/services/entityFuzzyMatch';
import { AI_CONSENT_KEY, canDoVision } from '@/services/aiProvider';
import { extractFieldsWithLlm } from '@/services/ocrLlmExtractor';
import { classifyDocument } from '@/services/aiClassifier';
import type { ClassifyCandidate } from '@/services/aiClassifier';
import { ClassifyConfirmSheet } from '@/components/ClassifyConfirmSheet';
import { FullscreenPhotoModal } from '@/components/document/FullscreenPhotoModal';
import { AutoDeletePicker } from '@/components/document/AutoDeletePicker';
import { PrivateNotesField } from '@/components/document/PrivateNotesField';
import { EntityLinkPicker } from '@/components/document/EntityLinkPicker';
import { DocTypePicker } from '@/components/document/DocTypePicker';
import { DocumentMetadataFields } from '@/components/document/DocumentMetadataFields';
import { scanDocumentPages } from '@/services/documentScanner';
import {
  saveImageAsPage,
  saveScannedPagesBatch,
  savePdfAsPage,
} from '@/services/documentPageStorage';

function isValidEntityType(v: string | undefined): v is EntityType {
  return typeof v === 'string' && (ALL_ENTITY_TYPES as string[]).includes(v);
}

/** Prag confidence pentru auto-set tip după AI classify. Sub valoare → întrebăm userul. */
const CLASSIFY_CONFIDENCE_AUTO_THRESHOLD = 0.75;

// Build universe of types ONCE at module load. Filtered later prin
// useFilteredDocTypes() la randare; aici e legitim să iterăm peste sursă.
// eslint-disable-next-line local-rules/no-direct-doc-type-iteration
const ALL_STANDARD_TYPES = Object.entries(DOCUMENT_TYPE_LABELS)
  .filter(([value]) => value !== 'custom')
  .map(([value, label]) => ({ value: value as DocumentType, label }));

// Helper centralizat — folosește sursa unică NO_EXPIRY_DOC_TYPES din types.
// Acoperă certificate stare civilă, diplome, acte de proprietate, bonuri etc.
function isNoExpiryType(t: DocumentType): boolean {
  return NO_EXPIRY_DOC_TYPES.has(t);
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
    entityType?: string;
  }>();
  const { createDocument, refresh } = useDocuments();
  const { persons, properties, vehicles, cards, animals, companies, resolveEntityName } =
    useEntities();
  const headerHeight = useHeaderHeight();
  const { customTypes } = useCustomTypes();
  const { visibleEntityTypes } = useVisibilitySettings();
  const { autoActivatedType, setAutoActivatedType, activateIfNeeded } = useAutoActivateDocType();

  const [type, setType] = useState<DocumentType>((params.type as DocumentType) || 'altul');
  // Marker: utilizatorul a fixat manual tipul (din params sau din picker).
  const userManuallySetTypeRef = useRef<boolean>(Boolean(params.type));
  const [classifySheetVisible, setClassifySheetVisible] = useState(false);
  const [classifySheetTop3, setClassifySheetTop3] = useState<ClassifyCandidate[]>([]);
  const classifyResolverRef = useRef<((type: DocumentType | null) => void) | null>(null);
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
  const [visionAvailable, setVisionAvailable] = useState(false);
  const [duplicateDoc, setDuplicateDoc] = useState<Document | null>(null);
  const [photoRefreshKey, setPhotoRefreshKey] = useState(0);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(AI_CONSENT_KEY).then(v => setTextAiConsentAvailable(v === 'true'));
    canDoVision().then(setVisionAvailable);
  }, []);

  // Re-citește capabilitatea vision când ecranul recapătă focus — userul poate
  // schimba configurația AI din Setări și să se întoarcă cu un alt răspuns.
  useFocusEffect(
    useCallback(() => {
      canDoVision().then(setVisionAvailable);
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      if (!hasMountedRef.current) {
        hasMountedRef.current = true;
        return;
      }
      setPhotoRefreshKey(k => k + 1);
    }, [])
  );

  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [typePickerVisible, setTypePickerVisible] = useState(false);

  // Entity picker state
  const [entityLinks, setEntityLinks] = useState<DocumentEntityLink[]>(() => {
    const initial: DocumentEntityLink[] = [];
    for (const entityType of ALL_ENTITY_TYPES) {
      const entityId = params[`${entityType}_id` as keyof typeof params];
      if (entityId) initial.push({ entityType, entityId });
    }
    return initial;
  });
  const [pickerCategory, setPickerCategory] = useState<EntityType>(
    () => entityLinks[0]?.entityType ?? 'person'
  );

  // Tipurile de entități atașate documentului — folosite ca să arătăm doar
  // tipurile relevante în picker-ul de document (Option B din spec).
  const attachedEntityTypes = useMemo<EntityType[]>(
    () => Array.from(new Set(entityLinks.map(l => l.entityType))),
    [entityLinks]
  );

  // Override entitate-aware: dacă există entități atașate, picker-ul afișează
  // tipurile relevante (ENTITY_DOCUMENT_TYPES[entity]) indiferent de setări;
  // altfel, comportament clasic filtrat pe setări.
  const { visibleDocTypes: contextVisibleDocTypes } = useFilteredDocTypes(
    attachedEntityTypes.length > 0 ? { entityTypes: attachedEntityTypes } : undefined
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
    findDuplicateDocument(entityLinks, liveOcrText || undefined)
      .then(setDuplicateDoc)
      .catch(() => setDuplicateDoc(null));
  }, [entityLinks, liveOcrText]);

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

  const fullscreenPhotos = useMemo(
    () => photoPages.filter(p => !isPdfFile(p.uri) && !isPdfFile(p.id)),
    [photoPages]
  );

  function handleFullscreen(uri: string) {
    const idx = fullscreenPhotos.findIndex(p => p.uri === uri);
    if (idx >= 0) setFullscreenIndex(idx);
  }

  // Marchează tipul ca fiind setat manual de utilizator (din picker)
  // și actualizează state-ul. Folosit la handler-ele picker-ului de tip.
  function setTypeManual(t: DocumentType) {
    userManuallySetTypeRef.current = true;
    setType(t);
  }

  // Deschide ClassifyConfirmSheet și returnează tipul confirmat sau null la anulare.
  function openClassifyConfirmSheet(top3: ClassifyCandidate[]): Promise<DocumentType | null> {
    return new Promise(resolve => {
      // Defensiv: dacă un resolver anterior e pending (re-entrancy), îl rezolvăm
      // cu null ca să nu rămână orphan și să blocheze flow-ul anterior.
      if (classifyResolverRef.current) {
        classifyResolverRef.current(null);
      }
      setClassifySheetTop3(top3);
      setClassifySheetVisible(true);
      classifyResolverRef.current = resolve;
    });
  }

  function resolveClassifySheet(t: DocumentType | null) {
    setClassifySheetVisible(false);
    const resolve = classifyResolverRef.current;
    classifyResolverRef.current = null;
    if (resolve) resolve(t);
  }

  // ── Entity fuzzy match local ──────────────────────────────────────────────
  // Fallback când AI-ul nu sugerează nicio entitate: caută simplul subșir al
  // numelui entității (normalizat fără diacritice) în textul OCR.

  function tryLocalEntityMatch(ocrText: string) {
    if (entityLinks.length > 0) return;
    const best = matchEntityInOcr(ocrText, {
      persons,
      vehicles,
      properties,
      animals,
      companies,
    });
    if (!best) return;
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
        contextVisibleDocTypes.includes(detectedType)
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
      // Pentru tipuri permanente (certificate stare civilă, diplome, acte
      // proprietate etc.) NU completăm expiry_date — chiar dacă OCR găsește
      // o dată în document, e probabil data emiterii, nu o expirare reală.
      const allowExpiryHere = !isNoExpiryType(docType);
      if (extracted.expiry_date && allowExpiryHere) {
        setExpiryDate(extracted.expiry_date);
        expiryDateRef.current = extracted.expiry_date;
      } else if (
        info.expiry_date &&
        !expiryDateRef.current &&
        allowExpiryHere &&
        docType !== 'talon'
      ) {
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

      // Aplică tipul documentului dacă AI-ul l-a detectat
      if (
        result.documentType &&
        result.documentType !== 'altul' &&
        result.documentType !== 'custom'
      ) {
        const detectedType = result.documentType;
        setType(detectedType);
        setCustomTypeId(null);
        setMetadata({});
        await activateIfNeeded(detectedType, contextVisibleDocTypes);
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
      const effectiveType = result.documentType ?? type;
      if (result.expiryDate && !isNoExpiryType(effectiveType)) {
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

    setLlmFieldLoading(true);
    try {
      // ─── Classify step (doar dacă utilizatorul NU a ales manual tipul) ────────
      let resolvedType: DocumentType = type;
      if (!userManuallySetTypeRef.current) {
        const firstPage = pages[0];
        const firstOcrText = ocrTextsRef.current.get(firstPage.localPath) ?? '';
        let firstImageBase64: string | undefined;
        try {
          if (isPdfFile(firstPage.localPath)) {
            firstImageBase64 =
              (await renderPdfFirstPageForVision(firstPage.localPath)) ?? undefined;
          } else {
            firstImageBase64 = await FileSystem.readAsStringAsync(firstPage.localPath, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }
        } catch {}

        const entityType = isValidEntityType(params.entityType) ? params.entityType : undefined;
        const candidates = entityType ? ENTITY_DOCUMENT_TYPES[entityType] : undefined;

        let classifyResult;
        try {
          classifyResult = await classifyDocument(firstOcrText, firstImageBase64, candidates);
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Eroare necunoscută';
          Alert.alert(
            'Detectare tip indisponibilă',
            `${msg}\n\nContinuă cu tipul curent: ${DOCUMENT_TYPE_LABELS[type] ?? type}.`
          );
          classifyResult = null;
        }

        if (classifyResult) {
          if (
            classifyResult.confidence >= CLASSIFY_CONFIDENCE_AUTO_THRESHOLD &&
            classifyResult.type !== 'altul'
          ) {
            resolvedType = classifyResult.type;
            setType(classifyResult.type);
          } else {
            const confirmed = await openClassifyConfirmSheet(classifyResult.top3);
            if (!confirmed) {
              setLlmFieldLoading(false);
              return;
            }
            resolvedType = confirmed;
            setType(confirmed);
          }
        }
      }

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

        const extracted = await extractFieldsWithLlm(resolvedType, ocrText, imageBase64);

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

        if (extracted.ocr_text) {
          ocrTextsRef.current.set(page.localPath, extracted.ocr_text);
          ocrStructuredTextsRef.current.set(page.localPath, extracted.ocr_text);
        }

        // Talon fără expiry → ștampilă ITP ilizibilă, cere completare manuală
        if (resolvedType === 'talon' && !extracted.expiry_date && !expiryDateRef.current) {
          const warning =
            extracted.metadata.itp_warning ??
            'Nu am putut detecta cu certitudine data expirării ITP de pe ștampila talonului. Verifică talonul și completează manual data în câmpul „Expiră".';
          Alert.alert('Data ITP necesită completare manuală', warning);
        }
      }

      const combinedAiOcr = Array.from(ocrStructuredTextsRef.current.values())
        .filter(Boolean)
        .join('\n\n---\n\n');
      if (combinedAiOcr) setLiveOcrText(combinedAiOcr);

      const combined = fileNotes.join('\n___________\n');
      if (combined) setNote(combined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Eroare necunoscută';
      if (msg.includes('limita')) {
        Alert.alert('Limită AI atinsă', msg);
      } else {
        Alert.alert(
          'AI nu a putut analiza documentul',
          `${msg}\n\nVerifică conexiunea la internet și reîncearcă. Dacă persistă, completează manual câmpurile.`
        );
      }
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

      const { localPath: dest } = await savePdfAsPage(asset.uri);
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
            contextVisibleDocTypes.includes(detectedType)
          ) {
            setType(detectedType);
            setCustomTypeId(null);
            setMetadata({});
          }
          const info = extractDocumentInfo(text);
          const effectiveType = detectedType ?? type;
          const fields = extractFieldsForType(effectiveType, text);
          if (Object.keys(fields.metadata).length > 0) {
            setMetadata(prev => ({ ...fields.metadata, ...prev }));
          }
          const allowExpiryScan = !isNoExpiryType(effectiveType);
          if (fields.expiry_date && !expiryDateRef.current && allowExpiryScan) {
            setExpiryDate(fields.expiry_date);
            expiryDateRef.current = fields.expiry_date;
          } else if (info.expiry_date && !expiryDateRef.current && allowExpiryScan) {
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
      { text: 'Galerie', onPress: pickImage },
      { text: 'Adaugă PDF', onPress: pickPdf },
      { text: 'Anulare', style: 'cancel' },
    ]);
  }

  async function processAndSaveImage(uri: string, exifOrientation?: number) {
    try {
      const saved = await saveImageAsPage(uri, type, exifOrientation);
      setPages(prev => [...prev, { uri: saved.processedUri, localPath: saved.localPath }]);
      runOcrOnImage(saved.localPath);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut procesa imaginea');
    }
  }

  async function processAndSaveScannedPages(uris: string[]) {
    if (uris.length === 0) return;
    try {
      const newPages = await saveScannedPagesBatch(uris, type);
      setPages(prev => [
        ...prev,
        ...newPages.map(p => ({ uri: p.localPath, localPath: p.localPath })),
      ]);
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
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];

    const requestId = makeRequestId();
    const cropPromise = awaitCropper(requestId);
    router.push({ pathname: '/cropper', params: { uri: asset.uri, requestId } });
    const croppedUri = await cropPromise;
    if (!croppedUri) return;

    // Imaginea cropped a fost generată de expo-image-manipulator → EXIF
    // normalizat în output, nu mai trecem orientarea originală mai departe.
    await processAndSaveImage(croppedUri);
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
            expiry_date: !isNoExpiryType(duplicateDoc.type)
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
        expiry_date: !isNoExpiryType(type) ? expiryDateRef.current.trim() || undefined : undefined,
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
      const navigateBack = () => router.replace('/(tabs)/documente');
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
        promptAddExpiryReminder({
          documentId: newDoc.id,
          docType: type,
          expiryDate: finalExpiry,
          entityName,
          note: note.trim() || undefined,
          onDone: navigateBack,
        });
        return;
      }

      if (type === 'bilet' && metadata.event_date && isCalendarAvailable()) {
        const title =
          [metadata.categorie, metadata.venue].filter(Boolean).join(' – ') || 'Eveniment';
        setLoading(false);
        promptAddEventReminder({
          documentId: newDoc.id,
          eventDate: metadata.event_date,
          title,
          venue: metadata.venue,
          note: note.trim() || undefined,
          onDone: navigateBack,
        });
        return;
      }

      navigateBack();
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

  // Sursa unică pentru afișarea entității — vezi useEntities.resolveEntityName.
  const getEntityDisplayName = resolveEntityName;

  const visibleStandardTypes = ALL_STANDARD_TYPES.filter(({ value }) =>
    contextVisibleDocTypes.includes(value)
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
          onFullscreen={handleFullscreen}
          onReorderPage={handleReorderPage}
        />
        {aiOcrApplied && (
          <View style={[styles.aiBadge, { backgroundColor: C.primaryMuted ?? primaryMuted }]}>
            <Text style={[styles.aiBadgeText, { color: primary }]}>
              ✦ Câmpuri completate cu AI · Verifică înainte de salvare
            </Text>
          </View>
        )}
        <AiActionsRow
          busy={aiOcrLoading || llmFieldLoading}
          busyLabel={llmFieldLoading ? 'Analizez documentul cu AI...' : 'Analizez cu AI...'}
          showAction={
            textAiConsentAvailable && visionAvailable && pages.length > 0 && !llmFieldLoading
          }
          onAction={handleAiImageAnalysis}
        />

        {autoActivatedType && (
          <AutoActivatedBanner
            type={autoActivatedType}
            onDismiss={() => setAutoActivatedType(null)}
          />
        )}

        {duplicateDoc && (
          <DuplicateBanner
            doc={duplicateDoc}
            onPress={() => router.push(`/(tabs)/documente/${duplicateDoc.id}`)}
          />
        )}

        {/* 2. TIP DOCUMENT */}
        <DocTypePicker
          scheme={scheme}
          type={type}
          customTypeId={customTypeId}
          visibleStandardTypes={visibleStandardTypes}
          customTypes={customTypes}
          expanded={typePickerVisible}
          hasHiddenTypes={hasHiddenTypes}
          onToggleExpanded={() => setTypePickerVisible(v => !v)}
          onSelectStandard={value => {
            const combinedText = Array.from(ocrTextsRef.current.values()).join('\n\n---\n\n');
            setTypeManual(value);
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
          onSelectCustom={id => {
            setTypeManual('custom');
            setCustomTypeId(id);
            setMetadata({});
            setTypePickerVisible(false);
          }}
          onPressHiddenTypesLink={() => router.push('/(tabs)/setari')}
        />

        {/* 3. CÂMPURI SPECIFICE TIPULUI */}
        <DocumentMetadataFields
          scheme={scheme}
          type={type}
          metadata={metadata}
          editable={!loading}
          onChange={(key, value) => setMetadata(prev => ({ ...prev, [key]: value }))}
        />

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
        {!isNoExpiryType(type) && (
          <DatePickerField
            label={EXPIRY_FIELD_LABEL[type] ?? 'Data expirare (opțional)'}
            value={expiryDate}
            onChange={v => {
              expiryDateRef.current = v;
              setExpiryDate(v);
            }}
            disabled={loading}
          />
        )}
        {expiryDate && !isNoExpiryType(type) ? (
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
        <AutoDeletePicker
          value={autoDelete}
          hasExpiryDate={!!expiryDate}
          scheme={scheme}
          onChange={setAutoDelete}
        />

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
        <PrivateNotesField
          value={privateNotes}
          scheme={scheme}
          editable={!loading}
          onChange={setPrivateNotes}
        />

        {/* 7. LEAGĂ DE ENTITATE */}
        <EntityLinkPicker
          scheme={scheme}
          entityLinks={entityLinks}
          pickerCategory={pickerCategory}
          pickerEntities={pickerEntities}
          visibleEntityTypes={visibleEntityTypes}
          resolveEntityName={getEntityDisplayName}
          onChangeCategory={setPickerCategory}
          onToggleEntity={toggleEntityLink}
        />
      </FormPageScreen>

      <ClassifyConfirmSheet
        visible={classifySheetVisible}
        top3={classifySheetTop3}
        allowedTypes={
          isValidEntityType(params.entityType)
            ? ENTITY_DOCUMENT_TYPES[params.entityType]
            : undefined
        }
        onCancel={() => resolveClassifySheet(null)}
        onConfirm={t => resolveClassifySheet(t)}
      />

      <FullscreenPhotoModal
        photos={fullscreenPhotos}
        initialIndex={fullscreenIndex}
        onClose={() => setFullscreenIndex(null)}
      />
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
  selectedBadge: { color: primary },
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
});
