import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  Pressable,
  ActivityIndicator,
  Modal,
  useWindowDimensions,
  StatusBar,
  Linking,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
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
} from '@/services/documents';
import type { DocumentDuplicates } from '@/services/documents';
import type { DocumentEntityLink, EntityType } from '@/types';
import { scheduleExpirationReminders } from '@/services/notifications';
import {
  addExpiryCalendarEvent,
  addEventToCalendar,
  updateExpiryCalendarEvent,
  updateBiletCalendarEvent,
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
import { renderAllPdfPagesAsBase64 } from '@/services/pdfOcr';
import { getDocumentLabel } from '@/types';
import type { Document as DocType } from '@/types';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useEntities } from '@/hooks/useEntities';
import { DOCUMENT_FIELDS } from '@/types/documentFields';
import type { FieldDef } from '@/types/documentFields';

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function autoDeleteLabel(rule: string): string {
  if (rule === 'expiry') return 'La data expirării';
  const m = rule.match(/^(\d+)d$/);
  if (m) {
    const d = parseInt(m[1], 10);
    if (d === 30) return '30 de zile';
    if (d === 90) return '90 de zile';
    if (d === 180) return '180 de zile';
    if (d === 365) return '1 an';
    return `${d} zile`;
  }
  return rule;
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
  const { companies, persons, properties, vehicles, cards, animals } = useEntities();
  const [doc, setDoc] = useState<DocType | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  // Rotire imagini (per pagina, cheie = file_path)
  const [rotatedUris, setRotatedUris] = useState<Record<string, string>>({});

  const [fullscreenUri, setFullscreenUri] = useState<string | null>(null);
  const [fullscreenPdfUri, setFullscreenPdfUri] = useState<string | null>(null);

  function handleFullscreen(uri: string) {
    setFullscreenUri(uri);
  }
  const [entityLinks, setEntityLinks] = useState<DocumentEntityLink[]>([]);
  const [privateVisible, setPrivateVisible] = useState(false);
  const [duplicates, setDuplicates] = useState<DocumentDuplicates>({
    byHash: [],
    byTypeAndEntity: [],
  });
  const [focusNonce, setFocusNonce] = useState(0);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

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
      // Normalizează EXIF (bake-in rotația) înainte de salvare
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
      // Pasăm documentul actualizat la OCR ca să nu folosim closure-ul stale
      if (updated) runOcrOnNewPage(relativePath, updated);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut adăuga pagina');
    }
  }

  // Încearcă să găsească orientarea corectă a imaginii via OCR.
  // Dacă pagina e lock-uită (userul a rotit-o manual), respectă orientarea
  // curentă și nu mai încearcă rotații. Altfel, dacă textul inițial e prea scurt,
  // testează 90°/270°/180° și salvează versiunea cea mai bună.
  async function ocrWithAutoRotate(
    storedPath: string,
    isLocked: boolean
  ): Promise<{ text: string; rotated: boolean }> {
    const fileUri = toFileUri(storedPath);
    let { text } = await extractText(fileUri);

    if (isLocked) return { text, rotated: false };
    if (text.trim().length >= 30) return { text, rotated: false };

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

  function handleAddPage() {
    Alert.alert('Adaugă atașament', '', [
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
      const newExpiry = extracted.expiry_date ?? info.expiry_date;
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
                await updateDocument(doc!.id, {
                  type: typeChanged ? effectiveType : doc!.type,
                  issue_date: newIssue ?? doc!.issue_date,
                  expiry_date: newExpiry ?? doc!.expiry_date,
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
      const imgTags: string[] = [];
      for (const page of allPages) {
        const fileUri = toFileUri(page.file_path);
        if (isPdfFile(page.file_path)) {
          // Randează fiecare pagină PDF ca imagine
          const pages = await renderAllPdfPagesAsBase64(fileUri);
          for (const b64 of pages) {
            imgTags.push(`<div class="img-page"><img src="data:image/jpeg;base64,${b64}" /></div>`);
          }
        } else {
          try {
            const compressed = await ImageManipulator.manipulateAsync(
              fileUri,
              [{ resize: { width: 1400 } }],
              { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
            );
            const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            imgTags.push(
              `<div class="img-page"><img src="data:image/jpeg;base64,${base64}" /></div>`
            );
          } catch {
            // imaginea nu a putut fi citită — continuăm
          }
        }
      }
      if (imgTags.length === 0 && allPages.length > 0) {
        Alert.alert(
          'Atenție',
          'Paginile nu au putut fi incluse în PDF. Va conține doar datele documentului.'
        );
      }

      const docLabel = escapeHtml(getDocumentLabel(doc, customTypes));
      const generatedDate = new Date().toLocaleDateString('ro-RO', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });

      // Câmpuri metadata
      const metaFields: string[] = [];
      if (doc.issue_date)
        metaFields.push(`
        <div class="field">
          <div class="field-label">Data emisiunii</div>
          <div class="field-value">${escapeHtml(doc.issue_date)}</div>
        </div>`);
      if (doc.expiry_date)
        metaFields.push(`
        <div class="field">
          <div class="field-label">Data expirării</div>
          <div class="field-value">${escapeHtml(doc.expiry_date)}</div>
        </div>`);
      if (doc.metadata) {
        const { DOCUMENT_FIELDS } = require('@/types/documentFields');
        const fields = DOCUMENT_FIELDS[doc.type] ?? [];
        for (const f of fields) {
          const val = doc.metadata[f.key];
          if (val)
            metaFields.push(`
            <div class="field">
              <div class="field-label">${escapeHtml(f.label)}</div>
              <div class="field-value">${escapeHtml(val)}</div>
            </div>`);
        }
      }

      const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4 portrait; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, Helvetica, Arial, sans-serif; background: #fff; color: #1e2318; }

  /* 100vw/100vh = dimensiunea exacta a paginii din printToFileAsync (A4: 595x842pt) */
  /* Fara page-break explicit — inaltimea 100vh asigura ca elementul urmator incepe pe pagina noua */
  .img-page {
    width: 100vw;
    height: 100vh;
    padding: 12mm;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .img-page img {
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    display: block;
  }

  /* Pagina de meta */
  .meta-page { padding: 12mm; page-break-inside: avoid; }
  .meta-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding-bottom: 4mm;
    border-bottom: 2px solid ${primary};
    margin-bottom: 6mm;
  }
  .meta-brand { font-size: 16px; font-weight: 800; color: #1a1a1a; }
  .meta-brand-url { font-size: 11px; font-weight: 400; color: #666; margin-left: 8px; vertical-align: middle; }
  .meta-doc-type { font-size: 24px; font-weight: 700; margin-bottom: 6mm; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-bottom: 4mm; }
  .field {
    background: #f8faf4; border: 1px solid #e2ebd4;
    border-radius: 6px; padding: 3mm 4mm;
  }
  .field-label {
    font-size: 8px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #374151; margin-bottom: 1.5mm;
  }
  .field-value { font-size: 13px; font-weight: 500; }
  .note-box {
    background: #f8faf4; border: 1px solid #e2ebd4;
    border-left: 3px solid ${primary};
    border-radius: 0 6px 6px 0; padding: 3mm 4mm; margin-bottom: 6mm;
  }
  .note-label {
    font-size: 8px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #374151; margin-bottom: 1.5mm;
  }
  .note-value { font-size: 12px; color: #444; line-height: 1.6; }
  .meta-footer {
    margin-top: 8mm; padding-top: 3mm;
    border-top: 0.5px solid #e2ebd4;
    display: flex; flex-direction: column; gap: 1mm;
    font-size: 8px; color: #bbb;
  }
  .meta-footer-brand { color: #1a1a1a; font-weight: 700; }

</style></head><body>

  ${imgTags.join('\n')}

  <div class="meta-page">
    <div class="meta-header">
      <div>
        <div class="meta-brand">Dosar <span class="meta-brand-url">tudorabrudan.github.io/Dosar</span></div>
      </div>
    </div>
    <div class="meta-doc-type">${docLabel}</div>
    ${metaFields.length > 0 ? `<div class="fields">${metaFields.join('')}</div>` : ''}
    ${doc.note ? `<div class="note-box"><div class="note-label">Notă</div><div class="note-value">${escapeHtml(doc.note)}</div></div>` : ''}
    <div class="meta-footer">
      <span class="meta-footer-brand">Generat cu Dosar · tudorabrudan.github.io/Dosar · App Store: apps.apple.com/ro/app/dosar-documente-personale/id6760576986</span>
      <span>Generat pe ${generatedDate}</span>
    </div>
  </div>


</body></html>`;
      const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 }); // A4 in points

      // Construiește numele fișierului: entitate-tip_document.pdf
      const firstLink = entityLinks[0];
      let entityName = '';
      if (firstLink) {
        switch (firstLink.entityType) {
          case 'person':
            entityName = persons.find(p => p.id === firstLink.entityId)?.name ?? '';
            break;
          case 'vehicle':
            entityName = vehicles.find(v => v.id === firstLink.entityId)?.name ?? '';
            break;
          case 'property':
            entityName = properties.find(p => p.id === firstLink.entityId)?.name ?? '';
            break;
          case 'animal':
            entityName = animals.find(a => a.id === firstLink.entityId)?.name ?? '';
            break;
          case 'company':
            entityName = companies.find(c => c.id === firstLink.entityId)?.name ?? '';
            break;
        }
      }
      const docTypeSlug = slugify(getDocumentLabel(doc, customTypes));
      const parts = [slugify(entityName), docTypeSlug].filter(Boolean);
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

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

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
            return (
              <View
                key={`${pdfPage.id}_${focusNonce}`}
                style={[styles.pdfContainer, { borderColor: colors.border }]}
              >
                <View style={styles.pdfHeaderRow}>
                  <Text style={styles.pdfSectionLabel}>
                    PDF{' '}
                    {allPages.filter(p => isPdfFile(p.file_path)).length > 1 ? `(${idx + 1})` : ''}
                  </Text>
                  {Platform.OS === 'ios' && (
                    <Pressable
                      style={styles.pdfFullscreenBtn}
                      onPress={() => setFullscreenPdfUri(pdfUri)}
                    >
                      <Ionicons name="expand-outline" size={18} color={primary} />
                    </Pressable>
                  )}
                </View>
                {Platform.OS === 'ios' ? (
                  <WebView
                    source={{ uri: pdfUri }}
                    style={styles.pdfWebView}
                    originWhitelist={['file://*', '*']}
                    allowFileAccess
                    allowFileAccessFromFileURLs
                    allowUniversalAccessFromFileURLs
                    allowingReadAccessToURL={FileSystem.documentDirectory ?? undefined}
                    scrollEnabled
                  />
                ) : (
                  <Pressable
                    style={[styles.pdfOpenBtn, { backgroundColor: colors.card }]}
                    onPress={() => Linking.openURL(pdfUri)}
                  >
                    <Text style={styles.pdfOpenBtnText}>📄 Deschide PDF extern</Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        {(duplicates.byHash.length > 0 || duplicates.byTypeAndEntity.length > 0) && (
          <View style={styles.dupBox}>
            <View style={styles.dupHeader}>
              <Ionicons name="copy-outline" size={14} color="#8a6d2f" />
              <Text style={styles.dupHeaderText}>Posibil duplicat</Text>
            </View>
            {duplicates.byHash.length > 0 && (
              <View style={styles.dupSection}>
                <Text style={styles.dupSectionLabel}>
                  Fișier identic ({duplicates.byHash.length})
                </Text>
                {duplicates.byHash.map(d => (
                  <Pressable
                    key={d.id}
                    style={styles.dupRow}
                    onPress={() => router.push(`/(tabs)/documente/${d.id}`)}
                  >
                    <Text style={styles.dupRowText} numberOfLines={1}>
                      {getDocumentLabel(d, customTypes)}
                      {d.created_at
                        ? ` · ${new Date(d.created_at).toLocaleDateString('ro-RO')}`
                        : ''}
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color="#8a6d2f" />
                  </Pressable>
                ))}
              </View>
            )}
            {duplicates.byTypeAndEntity.length > 0 && (
              <View style={styles.dupSection}>
                <Text style={styles.dupSectionLabel}>
                  Același tip și entitate ({duplicates.byTypeAndEntity.length})
                </Text>
                {duplicates.byTypeAndEntity.map(d => (
                  <Pressable
                    key={d.id}
                    style={styles.dupRow}
                    onPress={() => router.push(`/(tabs)/documente/${d.id}`)}
                  >
                    <Text style={styles.dupRowText} numberOfLines={1}>
                      {getDocumentLabel(d, customTypes)}
                      {d.expiry_date
                        ? ` · expiră ${new Date(d.expiry_date).toLocaleDateString('ro-RO')}`
                        : d.issue_date
                          ? ` · emis ${new Date(d.issue_date).toLocaleDateString('ro-RO')}`
                          : ''}
                    </Text>
                    <Ionicons name="chevron-forward" size={14} color="#8a6d2f" />
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        )}

        {(() => {
          // Helper pentru numele entității
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
          const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
            person: '👤',
            vehicle: '🚗',
            property: '🏠',
            card: '💳',
            animal: '🐾',
            company: '🏢',
          };

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
                    <View
                      key={idx}
                      style={[
                        styles.entityChip,
                        { backgroundColor: palette.background, borderColor: palette.border },
                      ]}
                    >
                      <Text style={[styles.entityChipText, { color: palette.text }]}>
                        {ENTITY_TYPE_LABELS[link.entityType]} {entityLinkLabel(link)}
                      </Text>
                    </View>
                  ))}
                </View>
              </DocumentDetailRow>
              {doc.issue_date && <DocumentDetailRow label="Data emisiune" value={doc.issue_date} />}
              {doc.expiry_date && (
                <DocumentDetailRow
                  label={doc.type === 'factura' ? 'Scadență' : 'Data expirare'}
                  value={doc.expiry_date}
                />
              )}
              {doc.expiry_date && (
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
                      Adaugă reminder în calendar
                    </Text>
                  </Pressable>
                </DocumentDetailRow>
              )}
              {doc.auto_delete && (
                <DocumentDetailRow label="Auto-ștergere" value={autoDeleteLabel(doc.auto_delete)} />
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

        {doc.note && (
          <DocumentDetailCard title="Notă">
            <Pressable onLongPress={() => copyValue(doc.note!, 'Nota')}>
              <Text style={[styles.noteText, { color: palette.text }]}>{doc.note}</Text>
            </Pressable>
          </DocumentDetailCard>
        )}

        {doc.private_notes && (
          <DocumentDetailCard
            tone="sensitive"
            header={
              <View style={styles.privateHeader}>
                <Ionicons name="lock-closed" size={13} color={sensitive} />
                <Text style={styles.privateLabel}>Notă privată · nu se trimite la AI</Text>
                <Pressable
                  onPress={() => setPrivateVisible(v => !v)}
                  hitSlop={8}
                  style={styles.privateToggle}
                >
                  <Text style={styles.privateToggleText}>
                    {privateVisible ? 'Ascunde' : 'Arată'}
                  </Text>
                </Pressable>
              </View>
            }
          >
            <Pressable
              onLongPress={
                privateVisible ? () => copyValue(doc.private_notes!, 'Nota privată') : undefined
              }
            >
              <Text style={styles.privateValue}>
                {privateVisible
                  ? doc.private_notes
                  : '•'.repeat(Math.min(doc.private_notes.length, 16))}
              </Text>
            </Pressable>
          </DocumentDetailCard>
        )}

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
              Reminder eveniment în calendar
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

      <Modal visible={!!fullscreenPdfUri} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.fsOverlay}>
          <StatusBar hidden />
          {fullscreenPdfUri && (
            <WebView
              source={{ uri: fullscreenPdfUri }}
              style={{ flex: 1 }}
              originWhitelist={['file://*', '*']}
              allowFileAccess
              allowFileAccessFromFileURLs
              allowUniversalAccessFromFileURLs
              allowingReadAccessToURL={FileSystem.documentDirectory ?? undefined}
              scrollEnabled
            />
          )}
          <Pressable style={styles.fsCloseBtn} onPress={() => setFullscreenPdfUri(null)}>
            <Text style={styles.fsCloseBtnText}>✕</Text>
          </Pressable>
        </View>
      </Modal>

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  muted: { opacity: 0.7 },
  fsOverlay: { flex: 1, backgroundColor: '#000' },
  fsScrollContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fsCloseBtn: {
    position: 'absolute',
    top: 48,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fsCloseBtnText: { color: '#fff', fontSize: 20, fontWeight: '600' },
  pdfContainer: {
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
  },
  pdfSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
  },
  pdfWebView: {
    height: 350,
    width: '100%',
  },
  pdfHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  pdfFullscreenBtn: {
    padding: 4,
  },
  pdfOpenBtn: {
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    margin: 8,
  },
  pdfOpenBtnText: { color: primary, fontSize: 15, fontWeight: '500' },
  dupBox: {
    marginBottom: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: sensitiveBorder,
    borderRadius: 12,
    backgroundColor: sensitiveBg,
  },
  dupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  dupHeaderText: { fontSize: 12, color: sensitive, fontWeight: '700', letterSpacing: 0.3 },
  dupSection: { marginTop: 4 },
  dupSectionLabel: { fontSize: 11, color: sensitive, fontWeight: '600', marginBottom: 4 },
  dupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 8,
  },
  dupRowText: { fontSize: 14, flex: 1 },
  privateHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  privateLabel: { fontSize: 11, color: sensitive, flex: 1, fontWeight: '600' },
  privateToggle: { paddingHorizontal: 8, paddingVertical: 2 },
  privateToggleText: { fontSize: 12, color: sensitive, fontWeight: '600' },
  privateValue: { fontSize: 16, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  noteText: {
    fontSize: 15,
    lineHeight: 22,
  },
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
});
