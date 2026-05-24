import { useEffect, useState, useMemo, useCallback, type ReactNode } from 'react';
import { StyleSheet, ScrollView, Alert, Pressable, Linking, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import { useLocalSearchParams, router, Stack, useFocusEffect } from 'expo-router';
import { useTheme } from '@react-navigation/native';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';
import { Text, View } from '@/components/Themed';
import { DocumentPhotoSection } from '@/components/DocumentPhotoSection';
import type { PhotoPage } from '@/components/DocumentPhotoSection';
import { BottomActionBar } from '@/components/BottomActionBar';
import { DocumentDetailCard } from '@/components/DocumentDetailCard';
import { DocumentDetailRow } from '@/components/DocumentDetailRow';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, sensitive, sensitiveBorder, sensitiveBg } from '@/theme/colors';
import {
  getDocumentById,
  deleteDocument,
  updateDocument,
  addDocumentPage,
  removeDocumentPage,
  setDocumentOcrText,
  reorderAllDocumentFiles,
  getDocumentEntityLinks,
  findDuplicatesOfDocument,
  lockPageOrientation,
  lockMainOrientation,
  setDocumentCalendarEventId,
  setMedicalRemindersPromptedAt,
  setPendingReminders,
  getPendingReminders,
} from '@/services/documents';
import type { DocumentDuplicates, ActionableItem } from '@/services/documents';
import { MedicalRemindersModal } from '@/components/medical/MedicalRemindersModal';
import type { DocumentEntityLink, EntityType } from '@/types';
import { scheduleExpirationReminders } from '@/services/notifications';
import { retentionLabel } from '@/services/documentRetention';
import {
  addExpiryCalendarEvent,
  addEventToCalendar,
  updateExpiryCalendarEvent,
  updateBiletCalendarEvent,
  isCalendarAvailable,
} from '@/services/calendar';
import { extractDocumentInfo, detectDocumentType, formatOcrSummary } from '@/services/ocr';
import { ocrWithAutoRotate } from '@/services/ocrAutoRotate';
import { extractFieldsForType } from '@/services/ocrExtractors';
import { toFileUri } from '@/services/fileUtils';
import { extractTextFromPdf, isPdfFile } from '@/services/pdfExtractor';
import { buildDocumentPdfHtml, slugifyForPdfFilename } from '@/services/documentPdfExport';
import { FullscreenPhotoModal } from '@/components/document/FullscreenPhotoModal';
import { FullscreenPdfModal } from '@/components/document/FullscreenPdfModal';
import { DocumentPdfViewer } from '@/components/document/DocumentPdfViewer';
import { DuplicateGroupsCard } from '@/components/document/DuplicateGroupsCard';
import { scanDocumentPages } from '@/services/documentScanner';
import { processDocumentImage } from '@/services/imageProcessing';
import {
  getDocumentLabel,
  ENTITY_TYPE_EMOJI,
  NO_EXPIRY_DOC_TYPES,
  MEDICAL_DOC_TYPES,
} from '@/types';
import type { Document as DocType } from '@/types';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useEntities } from '@/hooks/useEntities';
import { DOCUMENT_FIELDS, EXPIRY_FIELD_LABEL } from '@/types/documentFields';
import type { FieldDef } from '@/types/documentFields';

// Minimal markdown subset for AI summary rendering.
// Supports `**bold**` inline + `- ` bullet lines. Anything else = plain paragraph.
function renderInlineMarkdown(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <Text key={idx} style={{ fontWeight: '700' }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return part;
  });
}

function renderMarkdown(text: string, textColor: string): ReactNode {
  const lines = text.split('\n');
  return lines.map((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <Text key={idx} style={{ height: 8 }} />;
    }
    if (trimmed.startsWith('- ')) {
      const content = trimmed.slice(2);
      return (
        <Text
          key={idx}
          style={{ color: textColor, fontSize: 14, lineHeight: 20, marginBottom: 4 }}
        >
          {'•  '}
          {renderInlineMarkdown(content)}
        </Text>
      );
    }
    return (
      <Text
        key={idx}
        style={{ color: textColor, fontSize: 14, lineHeight: 20, marginBottom: 4 }}
      >
        {renderInlineMarkdown(trimmed)}
      </Text>
    );
  });
}

export default function DocumentDetailScreen() {
  const { id, from, entityId } = useLocalSearchParams<{
    id: string;
    from?: string;
    entityId?: string;
  }>();
  const { colors } = useTheme();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const { customTypes } = useCustomTypes();
  const { companies, persons, properties, vehicles, cards, animals, resolveEntityName } =
    useEntities();
  const [doc, setDoc] = useState<DocType | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  // Rotire imagini (per pagina, cheie = file_path)
  const [rotatedUris, setRotatedUris] = useState<Record<string, string>>({});

  const [fullscreenIndex, setFullscreenIndex] = useState<number | null>(null);
  const [fullscreenPdfUri, setFullscreenPdfUri] = useState<string | null>(null);
  const [entityLinks, setEntityLinks] = useState<DocumentEntityLink[]>([]);
  const [privateVisible, setPrivateVisible] = useState(false);
  const [duplicates, setDuplicates] = useState<DocumentDuplicates>({
    byHash: [],
    byOcrPrefix: [],
  });
  const [focusNonce, setFocusNonce] = useState(0);
  const [reminderModalProps, setReminderModalProps] = useState<{
    items: ActionableItem[];
    recordId: string;
  } | null>(null);
  const [reExtracting, setReExtracting] = useState(false);

  const runReExtractAndReport = useCallback(
    async (docId: string) => {
      const { extractFromDocument } = await import('@/services/medicalExtractor');
      const result = await extractFromDocument(docId);
      const updated = await getDocumentById(docId);
      setDoc(updated);
      // Și refresh entity links ca să se vadă noul medical_record în diagnostic.
      const links = await getDocumentEntityLinks(docId);
      setEntityLinks(links);
      const itemsCount = updated?.pending_reminders_json
        ? (() => {
            try {
              return JSON.parse(updated.pending_reminders_json).length;
            } catch {
              return 0;
            }
          })()
        : 0;
      Alert.alert(
        'Re-extragere terminată',
        [
          `Status: ${result.status}`,
          `Observații inserate: ${result.inserted}`,
          `Rezumat AI: ${updated?.ai_summary ? `${updated.ai_summary.length} chars` : 'gol'}`,
          `Reminders pending: ${itemsCount}`,
          updated?.pending_reminders_json ? `\nJSON: ${updated.pending_reminders_json}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      );
    },
    []
  );

  const handleReExtractMedical = useCallback(async () => {
    if (!doc) return;
    setReExtracting(true);
    try {
      // Verifică dacă documentul are deja un link la medical_record.
      const links = await getDocumentEntityLinks(doc.id);
      const hasMedicalLink = links.some(l => l.entityType === 'medical_record');

      if (!hasMedicalLink) {
        // Caută dosarele medicale existente.
        const { listMedicalRecords } = await import('@/services/medicalRecord');
        const records = await listMedicalRecords();
        if (records.length === 0) {
          Alert.alert(
            'Niciun dosar medical',
            'Documentul nu poate fi extras pentru că nu există niciun dosar medical. Creează unul în Entități → Adaugă → Dosar medical, apoi încearcă din nou.'
          );
          setReExtracting(false);
          return;
        }
        if (records.length === 1) {
          // Un singur dosar — asociază automat și continuă.
          const { addEntityLinkToDocument } = await import('@/services/documents');
          await addEntityLinkToDocument(doc.id, {
            entityType: 'medical_record',
            entityId: records[0].id,
          });
        } else {
          // Multi-record — prompt user să aleagă.
          Alert.alert(
            'Alege dosarul medical',
            `Documentul nu e legat la niciun dosar medical. Există ${records.length} dosare. Alege unul pentru a continua:`,
            [
              { text: 'Anulează', style: 'cancel', onPress: () => setReExtracting(false) },
              ...records.slice(0, 4).map(r => ({
                text: r.name,
                onPress: async () => {
                  try {
                    const { addEntityLinkToDocument } = await import('@/services/documents');
                    await addEntityLinkToDocument(doc.id, {
                      entityType: 'medical_record',
                      entityId: r.id,
                    });
                    await runReExtractAndReport(doc.id);
                  } catch (e) {
                    Alert.alert(
                      'Eroare',
                      e instanceof Error ? e.message : 'Eroare necunoscută'
                    );
                  } finally {
                    setReExtracting(false);
                  }
                },
              })),
            ]
          );
          return; // Wait for user choice — handlers above set setReExtracting(false).
        }
      }

      await runReExtractAndReport(doc.id);
    } catch (e) {
      Alert.alert(
        'Eroare re-extragere',
        e instanceof Error ? e.message : 'Eroare necunoscută'
      );
    } finally {
      setReExtracting(false);
    }
  }, [doc, runReExtractAndReport]);

  useEffect(() => {
    if (!id) return;
    getDocumentById(id)
      .then(updated => {
        setDoc(updated);
        setRotatedUris({});
      })
      .catch(() => setDoc(null))
      .finally(() => setLoading(false));
    // Încarcă entity links din junction table
    getDocumentEntityLinks(id)
      .then(links => {
        setEntityLinks(links);
      })
      .catch(() => {});
    findDuplicatesOfDocument(id)
      .then(setDuplicates)
      .catch(() => {});
  }, [id]);

  // Reîncarcă documentul la revenirea din ecranul de editare
  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      // Forțează remount pentru Image (iOS uneori nu re-randează file:// URIs după ce
      // view-ul a fost acoperit de un alt ecran în stack).
      setFocusNonce(n => n + 1);
      getDocumentById(id)
        .then(updated => {
          if (updated) setDoc(updated);
        })
        .catch(() => {});
      getDocumentEntityLinks(id)
        .then(links => setEntityLinks(links))
        .catch(() => {});
      findDuplicatesOfDocument(id)
        .then(setDuplicates)
        .catch(() => {});
    }, [id])
  );

  // Detectează pending reminders medicale și deschide modalul (spec 2026-05-24 §9).
  // Doar prima dată (medical_reminders_prompted_at nul), doar dacă există date
  // viitoare (D14) și document legat de un medical_record.
  useEffect(() => {
    if (!doc) return;
    if (doc.medical_reminders_prompted_at) return;
    if (entityLinks.length === 0) return;
    const medicalLink = entityLinks.find(l => l.entityType === 'medical_record');
    if (!medicalLink) return;
    const recordId = medicalLink.entityId;
    let cancelled = false;
    (async () => {
      const items = await getPendingReminders(doc.id);
      if (cancelled) return;
      const todayIso = new Date().toISOString().slice(0, 10);
      const future = items.filter(
        i => i.suggested_date_iso !== null && i.suggested_date_iso >= todayIso
      );
      if (future.length === 0) return;
      setReminderModalProps({ items: future, recordId });
    })();
    return () => {
      cancelled = true;
    };
  }, [doc, entityLinks]);

  const handleReminderClose = useCallback(
    async (_decision: 'added' | 'skipped') => {
      if (!doc) return;
      try {
        await setMedicalRemindersPromptedAt(doc.id, new Date().toISOString());
        await setPendingReminders(doc.id, null);
      } catch {
        // best-effort — modalul se închide oricum
      }
      setReminderModalProps(null);
      try {
        const updated = await getDocumentById(doc.id);
        if (updated) setDoc(updated);
      } catch {
        // refresh best-effort
      }
    },
    [doc]
  );

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

  const photoPages: PhotoPage[] = useMemo(
    () =>
      allPages.map(p => ({
        id: p.id,
        uri: rotatedUris[p.file_path] ?? toFileUri(p.file_path),
      })),
    [allPages, rotatedUris]
  );

  // Lista folosită ca sursă pentru fullscreen (doar foto — PDF-urile au modal separat).
  const fullscreenPhotos = useMemo(
    () => photoPages.filter(p => !isPdfFile(p.uri) && !isPdfFile(p.id)),
    [photoPages]
  );

  function handleFullscreen(uri: string) {
    const idx = fullscreenPhotos.findIndex(p => p.uri === uri);
    if (idx >= 0) setFullscreenIndex(idx);
  }

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
    const page = allPages.find(p => p.id === pageId);
    if (!page) return;
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
            setRotatedUris(prev => {
              const next = { ...prev };
              delete next[page.file_path];
              return next;
            });
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

  async function saveAndAddPage(uri: string) {
    if (!doc) return;
    try {
      const filename = `doc_${Date.now()}.jpg`;
      const relativePath = `documents/${filename}`;
      const dest = `${FileSystem.documentDirectory}${relativePath}`;
      await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}documents`, {
        intermediates: true,
      });
      const processedUri = await processDocumentImage(uri, doc.type);
      await FileSystem.copyAsync({ from: processedUri, to: dest });
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
      // Pasăm documentul actualizat la OCR ca să nu folosim closure-ul stale
      if (updated) runOcrOnNewPage(relativePath, updated);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut adăuga pagina');
    }
  }

  async function runOcrOnNewPage(localPath: string, currentDoc: DocType) {
    try {
      // Pagină nou-adăugată — niciodată lock-uită; lăsăm auto-rotate să încerce
      const { text, rotated } = await ocrWithAutoRotate(localPath, false);

      if (!text.trim()) return;

      const detectedType = detectDocumentType(text);
      const info = extractDocumentInfo(text);
      const summary = formatOcrSummary(text, info);

      const effectiveType =
        detectedType && detectedType !== 'altul' && detectedType !== 'custom'
          ? detectedType
          : currentDoc.type;
      // Pentru tipuri NO_EXPIRY (certificate stare civilă, diplome, acte
      // proprietate, etc.), nu scriem niciodată expiry_date — chiar dacă OCR
      // a găsit o dată în text (cel mai probabil e data emiterii).
      const allowExpiry = !NO_EXPIRY_DOC_TYPES.has(effectiveType);
      const updates: Parameters<typeof updateDocument>[1] = {
        type: effectiveType,
        issue_date: info.issue_date ?? currentDoc.issue_date,
        expiry_date: allowExpiry ? (info.expiry_date ?? currentDoc.expiry_date) : undefined,
        note: !currentDoc.note && summary ? summary : currentDoc.note,
        file_path: currentDoc.file_path,
        auto_delete: currentDoc.auto_delete,
      };
      await updateDocument(currentDoc.id, updates);
      // Append textul OCR al noii pagini la cel existent
      const existingOcr = currentDoc.ocr_text ?? '';
      const newOcrText = existingOcr ? `${existingOcr}\n\n---\n\n${text}` : text;
      await setDocumentOcrText(currentDoc.id, newOcrText);
      const updated = await getDocumentById(currentDoc.id);
      setDoc(updated);
      if (rotated) setRotatedUris({});
    } catch {
      // OCR opțional
    }
  }

  async function saveAndAddPdf(sourceUri: string) {
    if (!doc) return;
    try {
      const filename = `doc_${Date.now()}.pdf`;
      const relativePath = `documents/${filename}`;
      const dest = `${FileSystem.documentDirectory}documents/${filename}`;
      await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}documents`, {
        intermediates: true,
      });
      await FileSystem.copyAsync({ from: sourceUri, to: dest });

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

      // Extrage text din PDF și actualizează OCR
      try {
        const text = await extractTextFromPdf(dest);
        if (text.trim()) {
          const existingOcr = doc.ocr_text ?? '';
          const newOcrText = existingOcr ? `${existingOcr}\n\n---\n\n${text}` : text;
          await setDocumentOcrText(doc.id, newOcrText);
          if (text.trim().length < 100) {
            Alert.alert('PDF scanat', 'PDF-ul pare a fi o scanare – textul extras este limitat.');
          }
        }
      } catch {
        // Extracția text e opțională
      }

      const updated = await getDocumentById(doc.id);
      setDoc(updated);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut adăuga PDF-ul');
    }
  }

  async function scanAndAddPages() {
    if (!doc) return;
    try {
      const uris = await scanDocumentPages();
      if (!uris) return;
      for (const uri of uris) {
        await saveAndAddPage(uri);
      }
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Scanarea a eșuat');
    }
  }

  function handleAddPage() {
    Alert.alert('Adaugă atașament', '', [
      { text: 'Scanează document', onPress: scanAndAddPages },
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

  const handleOcr = async () => {
    if (allPages.length === 0) {
      Alert.alert('Fără imagini', 'Nu există imagini atașate acestui document.');
      return;
    }
    setOcrLoading(true);
    try {
      // Scanează TOATE paginile, auto-rotează dacă e nevoie, combină textul
      const texts: string[] = [];
      let anyRotated = false;
      for (const page of allPages) {
        try {
          if (isPdfFile(page.file_path)) {
            // ML Kit nu suportă PDF — încearcă extracție text din PDF
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

      // Detectare tip document din text
      const detectedType = detectDocumentType(combinedText);
      const typeChanged =
        detectedType &&
        detectedType !== 'altul' &&
        detectedType !== 'custom' &&
        detectedType !== doc?.type;

      // Extracție structurată per tip document (folosim tipul detectat dacă există)
      const effectiveType = (typeChanged ? detectedType : doc?.type) ?? doc?.type ?? 'altul';
      const extracted = extractFieldsForType(effectiveType, combinedText);
      // Pentru tipuri NO_EXPIRY (certificate stare civilă, diplome, acte etc.)
      // ignorăm orice expiry_date extras din OCR — de regulă e data emiterii.
      const allowExpiry = !NO_EXPIRY_DOC_TYPES.has(effectiveType);
      const newExpiry = allowExpiry ? (extracted.expiry_date ?? info.expiry_date) : undefined;
      const newIssue = extracted.issue_date ?? info.issue_date;

      // Rezumat câmpuri găsite pentru alert
      const found: string[] = [];
      const metaEntries = Object.entries(extracted.metadata);
      if (metaEntries.length > 0) {
        // Afișăm primele 5 câmpuri găsite
        metaEntries.slice(0, 5).forEach(([, v]) => found.push(`• ${v}`));
        if (metaEntries.length > 5) found.push(`… și ${metaEntries.length - 5} mai multe`);
      }
      if (newExpiry && !found.some(f => f.includes(newExpiry)))
        found.push(`📅 Expiră: ${newExpiry}`);
      if (newIssue && !found.some(f => f.includes(newIssue))) found.push(`📅 Emis: ${newIssue}`);
      if (!found.length) {
        if (info.name) found.push(`👤 ${info.name}`);
        if (info.cnp) found.push(`🔢 CNP: ${info.cnp}`);
        if (info.series) found.push(`🔠 ${info.series}`);
      }

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
                const mergedMeta = { ...(doc!.metadata ?? {}), ...extracted.metadata };
                // Dacă tipul efectiv e NO_EXPIRY, scriem explicit `undefined`
                // ca să curățăm orice expiry stale; altfel păstrăm valoarea
                // existentă dacă OCR nu a găsit ceva nou.
                const finalExpiry = allowExpiry
                  ? (newExpiry ?? doc!.expiry_date)
                  : undefined;
                await updateDocument(doc!.id, {
                  type: typeChanged ? effectiveType : doc!.type,
                  issue_date: newIssue ?? doc!.issue_date,
                  expiry_date: finalExpiry,
                  note: !doc!.note && summary ? summary : doc!.note,
                  file_path: doc!.file_path,
                  auto_delete: doc!.auto_delete,
                  metadata: mergedMeta,
                });
                await setDocumentOcrText(doc!.id, combinedText);
                const updated = await getDocumentById(doc!.id);
                setDoc(updated);
                Alert.alert('Salvat', 'Datele OCR au fost aplicate.');
              },
            }
          : {
              text: 'Copiază în notă',
              onPress: async () => {
                await setDocumentOcrText(doc!.id, combinedText);
                const updated = await getDocumentById(doc!.id);
                setDoc(updated);
                router.push(`/(tabs)/documente/edit?id=${doc!.id}`);
              },
            },
      ]);
    } catch (e) {
      Alert.alert('Eroare OCR', e instanceof Error ? e.message : 'Eroare la procesare');
    } finally {
      setOcrLoading(false);
    }
  };

  const handleCalendar = async () => {
    if (!doc) return;
    if (!isCalendarAvailable()) {
      Alert.alert('Calendar indisponibil', 'Calendarul necesită un build nativ (expo run:ios).');
      return;
    }
    const isBilet = doc.type === 'bilet' && !!doc.metadata?.event_date;
    const existingId = doc.calendar_event_id;

    if (isBilet) {
      const title =
        [doc.metadata?.categorie, doc.metadata?.venue].filter(Boolean).join(' – ') || 'Eveniment';
      const opts = {
        title,
        eventDate: doc.metadata!.event_date,
        venue: doc.metadata?.venue,
        note: doc.note,
        documentId: doc.id,
      };
      const calId = existingId
        ? await updateBiletCalendarEvent(existingId, opts)
        : await addEventToCalendar(opts);
      if (!calId) {
        Alert.alert('Eroare', 'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.');
        return;
      }
      if (calId !== existingId) await setDocumentCalendarEventId(doc.id, calId);
      Alert.alert(
        'Calendar',
        existingId ? 'Reminder actualizat în calendar.' : 'Reminder adăugat în calendar.'
      );
      const updated = await getDocumentById(doc.id);
      if (updated) setDoc(updated);
      return;
    }

    if (doc.expiry_date) {
      const opts = {
        docType: doc.type,
        expiryDate: doc.expiry_date,
        entityName: undefined,
        documentId: doc.id,
        note: doc.note,
        displayLabel: getDocumentLabel(doc, customTypes),
      };
      const calId = existingId
        ? await updateExpiryCalendarEvent(existingId, opts)
        : await addExpiryCalendarEvent(opts);
      if (!calId) {
        Alert.alert('Eroare', 'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.');
        return;
      }
      if (calId !== existingId) await setDocumentCalendarEventId(doc.id, calId);
      Alert.alert(
        'Calendar',
        existingId ? 'Reminder actualizat în calendar.' : 'Reminder adăugat în calendar.'
      );
      const updated = await getDocumentById(doc.id);
      if (updated) setDoc(updated);
    }
  };

  const handleDelete = () => {
    if (!doc) return;
    Alert.alert('Ștergere', `Ștergi documentul „${getDocumentLabel(doc, customTypes)}"?`, [
      { text: 'Anulare', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          await deleteDocument(doc.id);
          scheduleExpirationReminders().catch(() => {});
          router.back();
        },
      },
    ]);
  };

  const shareImageAtIndex = async (pageIndex: number) => {
    const page = allPages[pageIndex];
    if (!page) return;
    const fileUri = toFileUri(page.file_path);
    try {
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'image/jpeg',
          dialogTitle: `Distribuie: ${getDocumentLabel(doc!, customTypes)}`,
        });
      } else {
        await Share.share({
          message: shareMessage(doc!),
          title: getDocumentLabel(doc!, customTypes),
        });
      }
    } catch (e) {
      if ((e as Error)?.message?.includes('cancel') || (e as Error)?.message === 'User cancelled')
        return;
      Alert.alert('Eroare', (e as Error)?.message ?? 'Nu s-a putut distribui');
    }
  };

  const handleShare = async () => {
    if (!doc) return;
    if (allPages.length === 0) {
      await Share.share({ message: shareMessage(doc), title: getDocumentLabel(doc, customTypes) });
      return;
    }
    if (allPages.length === 1) {
      await shareImageAtIndex(0);
      return;
    }
    // Mai multe pagini — alege care să o distribui
    Alert.alert('Distribuie imagine', 'Alege pagina:', [
      ...allPages.map((_, idx) => ({
        text: `Pagina ${idx + 1}`,
        onPress: () => shareImageAtIndex(idx),
      })),
      { text: 'Anulare', style: 'cancel' as const },
    ]);
  };

  function shareMessage(d: DocType): string {
    const lines = [`Document: ${getDocumentLabel(d, customTypes)}`];
    if (d.issue_date) lines.push(`Emis: ${d.issue_date}`);
    if (d.expiry_date) lines.push(`Expiră: ${d.expiry_date}`);
    if (d.note) lines.push(`Notă: ${d.note}`);
    return lines.join('\n');
  }

  const handleExportPdf = async () => {
    if (!doc) return;
    setPdfLoading(true);
    try {
      const { html, pagesFailed } = await buildDocumentPdfHtml({
        doc,
        allPages,
        customTypes,
      });
      if (pagesFailed) {
        Alert.alert(
          'Atenție',
          'Paginile nu au putut fi incluse în PDF. Va conține doar datele documentului.'
        );
      }
      const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 }); // A4 in points

      const firstLink = entityLinks[0];
      const entityName = firstLink ? resolveEntityName(firstLink) : '';
      const docTypeSlug = slugifyForPdfFilename(getDocumentLabel(doc, customTypes));
      const parts = [slugifyForPdfFilename(entityName), docTypeSlug].filter(Boolean);
      const pdfFilename = parts.join('-') + '.pdf';
      const namedUri = (FileSystem.cacheDirectory ?? '') + pdfFilename;
      await FileSystem.copyAsync({ from: uri, to: namedUri });

      const available = await Sharing.isAvailableAsync();
      if (available)
        await Sharing.shareAsync(namedUri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Exportă ca PDF',
          UTI: 'com.adobe.pdf',
        });
      else await Share.share({ message: 'PDF generat', url: namedUri, title: pdfFilename });
    } catch (e) {
      if ((e as Error)?.message?.includes('cancel')) return;
      Alert.alert('Eroare', (e as Error)?.message ?? 'Nu s-a putut genera PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  async function copyValue(value: string, label: string) {
    try {
      await Clipboard.setStringAsync(value);
      Alert.alert('Copiat', `${label} a fost copiat în clipboard.`);
    } catch {
      // Silent fail.
    }
  }

  function handleBack() {
    if (from === 'home') {
      // Resetăm stack-ul documente la index, apoi trecem pe home tab.
      // Ambele navigate sunt batched de React Navigation → fără flash.
      router.navigate('/(tabs)/documente');
      router.navigate('/(tabs)');
    } else if (from === 'entity' && entityId) {
      // La fel: curățăm stack-ul documente, apoi mergem la entitate.
      router.navigate('/(tabs)/documente');
      router.navigate(`/(tabs)/entitati/${entityId}`);
    } else if (from === 'medical' && entityId) {
      router.navigate('/(tabs)/documente');
      router.navigate(`/(tabs)/entitati/medical/${entityId}?tab=documente`);
    } else if (from === 'medical-chat' && entityId) {
      router.navigate('/(tabs)/documente');
      router.navigate(`/(tabs)/entitati/medical/${entityId}?tab=chat`);
    } else if (from === 'expirari') {
      router.navigate('/(tabs)/documente');
      router.navigate('/(tabs)/expirari');
    } else if (from === 'chat') {
      router.navigate('/(tabs)/documente');
      router.navigate('/(tabs)/chat');
    } else {
      router.canGoBack() ? router.back() : router.navigate('/(tabs)/documente');
    }
  }

  if (loading || !doc) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{loading ? 'Se încarcă...' : 'Document negăsit'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: doc ? doc.note?.slice(0, 30) || 'Detaliu document' : 'Detaliu document',
          gestureEnabled: !from || from === 'documente',
          headerLeft: () => (
            <Pressable onPress={handleBack} style={{ paddingRight: 16 }}>
              <Text style={{ color: primary, fontSize: 16 }}>‹ Înapoi</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              onPress={() => router.push(`/(tabs)/documente/edit?id=${doc.id}`)}
              hitSlop={12}
              style={{ paddingLeft: 8 }}
            >
              <Ionicons name="create-outline" size={24} color={primary} />
            </Pressable>
          ),
        }}
      />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <DocumentPhotoSection
          pages={photoPages.filter(p => !isPdfFile(p.uri) && !isPdfFile(p.id))}
          ocrLoading={ocrLoading}
          ocrText={doc.ocr_text ?? undefined}
          isEditing={false}
          refreshKey={focusNonce}
          onAddPage={handleAddPage}
          onRotate={handleRotate}
          onDelete={handleDeletePage}
          onRunOcr={handleOcr}
          onFullscreen={handleFullscreen}
          onOcrTextSave={handleOcrSave}
        />
        {/* Vizualizare PDF — WKWebView redă PDF nativ pe iOS */}
        {allPages
          .filter(p => isPdfFile(p.file_path))
          .map((pdfPage, idx) => {
            const pdfUri = toFileUri(pdfPage.file_path);
            const totalPdfs = allPages.filter(p => isPdfFile(p.file_path)).length;
            return (
              <DocumentPdfViewer
                key={`${pdfPage.id}_${focusNonce}`}
                pdfUri={pdfUri}
                scheme={scheme === 'dark' ? 'dark' : 'light'}
                label={`PDF${totalPdfs > 1 ? ` (${idx + 1})` : ''}`}
                onFullscreen={() => setFullscreenPdfUri(pdfUri)}
              />
            );
          })}
        <DuplicateGroupsCard
          scheme={scheme === 'dark' ? 'dark' : 'light'}
          doc={doc}
          duplicates={duplicates}
          customTypes={customTypes}
          onOpenDocument={id => router.push(`/(tabs)/documente/${id}`)}
        />

        {(() => {
          // Helper pentru numele entității
          const entityLinkLabel = resolveEntityName;
          const ENTITY_TYPE_LABELS = ENTITY_TYPE_EMOJI;

          // Filtrează DOCUMENT_FIELDS — doar cele cu valoare nenulă/non-empty.
          const filteredFields = (DOCUMENT_FIELDS[doc.type] ?? []).filter((f: FieldDef) => {
            const v = doc.metadata?.[f.key];
            return v !== undefined && v !== null && v !== '';
          });

          return (
            <DocumentDetailCard title="Detalii">
              <DocumentDetailRow label="Tip" value={getDocumentLabel(doc, customTypes)} />
              <DocumentDetailRow label="Legat de">
                <View style={styles.entityLinksRow}>
                  {entityLinks.length === 0 && (
                    <Text style={[styles.entityPlaceholder, { color: palette.textSecondary }]}>
                      Nelegat
                    </Text>
                  )}
                  {entityLinks.map((link, idx) => (
                    <Pressable
                      key={idx}
                      onLongPress={() => copyValue(entityLinkLabel(link), 'Numele entității')}
                      accessibilityRole="button"
                      accessibilityHint="Ține apăsat pentru a copia"
                      style={[
                        styles.entityChip,
                        { backgroundColor: palette.background, borderColor: palette.border },
                      ]}
                    >
                      <Text style={[styles.entityChipText, { color: palette.text }]}>
                        {ENTITY_TYPE_LABELS[link.entityType]} {entityLinkLabel(link)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </DocumentDetailRow>
              {doc.issue_date && <DocumentDetailRow label="Data emisiune" value={doc.issue_date} />}
              {/* Display safety: chiar dacă DB are expiry_date stale (înainte
                  ca tipul să fie marcat NO_EXPIRY, sau migrat dintr-un format
                  vechi), nu îl afișăm pentru tipuri care, real, nu expiră. */}
              {doc.expiry_date && !NO_EXPIRY_DOC_TYPES.has(doc.type) && (
                <DocumentDetailRow
                  label={EXPIRY_FIELD_LABEL[doc.type] ?? 'Data expirare'}
                  value={doc.expiry_date}
                />
              )}
              {doc.expiry_date && !NO_EXPIRY_DOC_TYPES.has(doc.type) && (
                <DocumentDetailRow>
                  <Pressable
                    style={[
                      styles.calendarBtn,
                      { borderColor: palette.border, backgroundColor: palette.background },
                    ]}
                    onPress={handleCalendar}
                  >
                    <Text style={{ fontSize: 18 }}>📅</Text>
                    <Text style={[styles.calendarBtnLabel, { color: primary }]}>
                      {doc.calendar_event_id
                        ? 'Actualizare reminder în calendar'
                        : 'Adaugă reminder în calendar'}
                    </Text>
                  </Pressable>
                </DocumentDetailRow>
              )}
              {doc.auto_delete && (
                <DocumentDetailRow label="Auto-ștergere" value={retentionLabel(doc.auto_delete)} />
              )}
              {filteredFields.map((field: FieldDef) => (
                <DocumentDetailRow
                  key={field.key}
                  label={field.label}
                  value={String(doc.metadata![field.key])}
                />
              ))}
            </DocumentDetailCard>
          );
        })()}

        <DocumentDetailCard title="Notă (rezumat)">
          {doc.note ? (
            <Pressable
              onLongPress={() => copyValue(doc.note!, 'Nota')}
              accessibilityRole="button"
              accessibilityHint="Ține apăsat pentru a copia"
            >
              <Text style={[styles.noteText, { color: palette.text }]}>{doc.note}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push(`/(tabs)/documente/edit?id=${doc.id}`)}
              accessibilityRole="button"
            >
              <Text style={[styles.emptyHint, { color: palette.textSecondary }]}>
                Niciun rezumat. Apasă ✏️ sus pentru a adăuga.
              </Text>
            </Pressable>
          )}
        </DocumentDetailCard>

        {doc.ai_summary ? (
          <View
            style={[
              styles.aiSection,
              { borderColor: palette.border, backgroundColor: palette.card },
            ]}
          >
            <View style={styles.aiSectionHeader}>
              <Ionicons name="sparkles-outline" size={16} color={primary} />
              <Text style={[styles.aiSectionTitle, { color: palette.text }]}>Rezumat AI</Text>
            </View>
            {renderMarkdown(doc.ai_summary, palette.text)}
            <Text style={[styles.aiSummaryDisclaimer, { color: palette.textSecondary }]}>
              Generat automat, nu înlocuiește consultul medical.
            </Text>
          </View>
        ) : null}

        {/* Diagnostic AI — doar pentru documente medicale. Arată starea reală a
            extracției ca să nu fie magie neagră ce se întâmplă în background. */}
        {MEDICAL_DOC_TYPES.has(doc.type) ? (
          <View
            style={[
              styles.aiSection,
              { borderColor: palette.border, backgroundColor: palette.card },
            ]}
          >
            <View style={styles.aiSectionHeader}>
              <Ionicons name="bug-outline" size={16} color={palette.textSecondary} />
              <Text style={[styles.aiSectionTitle, { color: palette.text }]}>
                Diagnostic AI (medical)
              </Text>
            </View>
            <Text style={[styles.diagText, { color: palette.text }]}>
              <Text style={{ fontWeight: '700' }}>Rezumat AI:</Text>{' '}
              {doc.ai_summary ? `${doc.ai_summary.length} chars` : '(gol — extracția nu a rulat sau a eșuat)'}
            </Text>
            <Text style={[styles.diagText, { color: palette.text }]}>
              <Text style={{ fontWeight: '700' }}>Pending reminders:</Text>{' '}
              {doc.pending_reminders_json
                ? `${(() => {
                    try {
                      return JSON.parse(doc.pending_reminders_json).length;
                    } catch {
                      return '?';
                    }
                  })()} items`
                : '(gol)'}
            </Text>
            <Text style={[styles.diagText, { color: palette.text }]}>
              <Text style={{ fontWeight: '700' }}>Reminders prompted at:</Text>{' '}
              {doc.medical_reminders_prompted_at ?? '(nu)'}
            </Text>
            <Text style={[styles.diagText, { color: palette.text }]}>
              <Text style={{ fontWeight: '700' }}>Data document (issue_date):</Text>{' '}
              {doc.issue_date ?? '(neset)'}
            </Text>
            <Text style={[styles.diagText, { color: palette.text }]}>
              <Text style={{ fontWeight: '700' }}>OCR text:</Text>{' '}
              {doc.ocr_text ? `${doc.ocr_text.length} chars` : '(gol)'}
            </Text>
            <Text style={[styles.diagText, { color: palette.text }]}>
              <Text style={{ fontWeight: '700' }}>Entități legate:</Text>{' '}
              {entityLinks.length === 0
                ? '(niciuna — extragerea va eșua cu no_record)'
                : entityLinks.map(l => `${l.entityType}:${l.entityId.slice(0, 8)}`).join(', ')}
            </Text>
            <Text style={[styles.diagText, { color: palette.text }]}>
              <Text style={{ fontWeight: '700' }}>Legat la dosar medical:</Text>{' '}
              {entityLinks.some(l => l.entityType === 'medical_record') ? 'DA ✓' : 'NU ✗'}
            </Text>
            {doc.pending_reminders_json ? (
              <Text
                style={[styles.diagText, { color: palette.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11 }]}
                numberOfLines={6}
              >
                {doc.pending_reminders_json}
              </Text>
            ) : null}
            <Pressable
              style={[styles.calendarBtn, { borderColor: primary, backgroundColor: palette.background, marginTop: 12 }]}
              onPress={handleReExtractMedical}
              disabled={reExtracting}
            >
              <Text style={{ fontSize: 18 }}>{reExtracting ? '⏳' : '🔄'}</Text>
              <Text style={[styles.calendarBtnLabel, { color: primary }]}>
                {reExtracting ? 'Re-extragere în curs…' : 'Re-extrage AI (medical)'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <DocumentDetailCard
          tone="sensitive"
          header={
            <View style={styles.privateHeader}>
              <Ionicons name="lock-closed" size={13} color={sensitive} />
              <Text style={styles.privateLabel}>Notă privată · nu se trimite la AI</Text>
              {doc.private_notes ? (
                <Pressable
                  onPress={() => setPrivateVisible(v => !v)}
                  hitSlop={8}
                  style={styles.privateToggle}
                >
                  <Text style={styles.privateToggleText}>
                    {privateVisible ? 'Ascunde' : 'Arată'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
        >
          {doc.private_notes ? (
            <Pressable
              onLongPress={
                privateVisible ? () => copyValue(doc.private_notes!, 'Nota privată') : undefined
              }
              accessibilityRole="button"
              accessibilityHint={privateVisible ? 'Ține apăsat pentru a copia' : undefined}
            >
              <Text style={styles.privateValue}>
                {privateVisible
                  ? doc.private_notes
                  : '•'.repeat(Math.min(doc.private_notes.length, 16))}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push(`/(tabs)/documente/edit?id=${doc.id}`)}
              accessibilityRole="button"
            >
              <Text style={[styles.emptyHint, { color: palette.textSecondary }]}>
                Adaugă date sensibile (CVV, PIN, parole). Apasă ✏️ sus pentru a edita.
              </Text>
            </Pressable>
          )}
        </DocumentDetailCard>

        {doc.type === 'bilet' && doc.metadata?.event_date && (
          <Pressable
            style={[
              styles.calendarBtn,
              { borderColor: palette.border, backgroundColor: palette.card, marginBottom: 12 },
            ]}
            onPress={handleCalendar}
          >
            <Text style={{ fontSize: 18 }}>📅</Text>
            <Text style={[styles.calendarBtnLabel, { color: primary }]}>
              {doc.calendar_event_id
                ? 'Actualizare reminder în calendar'
                : 'Adaugă reminder în calendar'}
            </Text>
          </Pressable>
        )}

        {(doc.type === 'rca' || doc.type === 'itp') && (
          <Pressable style={styles.asigraBtn} onPress={() => Linking.openURL('https://asigra.ro')}>
            <Text style={styles.asigaBtnText}>🛡 RCA ieftină → asigra.ro</Text>
          </Pressable>
        )}
        {doc.type === 'casco' && (
          <Pressable style={styles.asigraBtn} onPress={() => Linking.openURL('https://asigra.ro')}>
            <Text style={styles.asigaBtnText}>🛡 CASCO ieftine → asigra.ro</Text>
          </Pressable>
        )}
        {doc.type === 'pad' && (
          <Pressable style={styles.asigraBtn} onPress={() => Linking.openURL('https://asigra.ro')}>
            <Text style={styles.asigaBtnText}>🏠 PAD ieftină → asigra.ro</Text>
          </Pressable>
        )}
      </ScrollView>

      <BottomActionBar
        actions={[
          {
            icon: 'document-text-outline',
            label: 'PDF',
            onPress: handleExportPdf,
            loading: pdfLoading,
          },
          {
            icon: 'share-outline',
            label: 'Distribuie',
            onPress: handleShare,
          },
          {
            icon: 'trash-outline',
            label: 'Șterge',
            onPress: handleDelete,
            danger: true,
          },
        ]}
      />

      <FullscreenPdfModal uri={fullscreenPdfUri} onClose={() => setFullscreenPdfUri(null)} />
      <FullscreenPhotoModal
        photos={fullscreenPhotos}
        initialIndex={fullscreenIndex}
        onClose={() => setFullscreenIndex(null)}
      />
      {reminderModalProps && doc ? (
        <MedicalRemindersModal
          visible={true}
          items={reminderModalProps.items}
          documentId={doc.id}
          recordId={reminderModalProps.recordId}
          onClose={handleReminderClose}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  muted: { opacity: 0.7 },
  privateHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  privateLabel: { fontSize: 11, color: sensitive, flex: 1, fontWeight: '600' },
  privateToggle: { paddingHorizontal: 8, paddingVertical: 2 },
  privateToggleText: { fontSize: 12, color: sensitive, fontWeight: '600' },
  privateValue: { fontSize: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  noteText: {
    fontSize: 15,
    lineHeight: 22,
  },
  emptyHint: { fontSize: 14, fontStyle: 'italic', lineHeight: 20 },
  entityPlaceholder: { opacity: 0.6, fontSize: 14, fontStyle: 'italic' },
  entityLinksRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4, marginBottom: 4 },
  entityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 5,
    paddingLeft: 10,
    paddingRight: 8,
    gap: 6,
  },
  entityChipText: { fontSize: 13, fontWeight: '500' },
  calendarBtn: {
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  calendarBtnLabel: { fontSize: 13, fontWeight: '600' },
  asigraBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: primary,
  },
  asigaBtnText: { color: primary, fontSize: 14, fontWeight: '600' },
  aiSection: { marginVertical: 12, padding: 14, borderRadius: 10, borderWidth: 1 },
  aiSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  aiSectionTitle: { fontSize: 14, fontWeight: '700' },
  aiSummaryDisclaimer: { fontSize: 11, marginTop: 8, fontStyle: 'italic' },
  diagText: { fontSize: 12, lineHeight: 18, marginBottom: 2 },
});
