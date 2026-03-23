import { useEffect, useState, useMemo } from 'react';
import { StyleSheet, ScrollView, Image, Alert, Pressable, ActivityIndicator, Modal, useWindowDimensions, StatusBar, Linking } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';
import { useLocalSearchParams, router } from 'expo-router';
import { useTheme } from '@react-navigation/native';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Share } from 'react-native';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { primary } from '@/theme/colors';
import {
  getDocumentById,
  deleteDocument,
  updateDocument,
  addDocumentPage,
  removeDocumentPage,
  setDocumentOcrText,
} from '@/services/documents';
import { scheduleExpirationReminders } from '@/services/notifications';
import { addExpiryCalendarEvent, addEventToCalendar, isCalendarAvailable } from '@/services/calendar';
import { extractText, extractDocumentInfo, detectDocumentType, formatOcrSummary } from '@/services/ocr';
import { DOCUMENT_TYPE_LABELS, getDocumentLabel } from '@/types';
import type { Document as DocType, DocumentType } from '@/types';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useFilteredDocTypes } from '@/hooks/useFilteredDocTypes';
import { useEntities } from '@/hooks/useEntities';
import { DatePickerField } from '@/components/DatePickerField';
import { DOCUMENT_FIELDS } from '@/types/documentFields';
import type { FieldDef } from '@/types/documentFields';


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
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { customTypes } = useCustomTypes();
  const { docTypeOptions: standardTypes } = useFilteredDocTypes();
  const { companies, persons, properties, vehicles, cards, animals } = useEntities();
  const [doc, setDoc] = useState<DocType | null>(null);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  // Rotire imagini (per pagina, cheie = file_path)
  const [rotatedUris, setRotatedUris] = useState<Record<string, string>>({});

  // Edit modal state
  const [editVisible, setEditVisible] = useState(false);
  const [editType, setEditType] = useState<DocumentType>('buletin');
  const [editCustomTypeId, setEditCustomTypeId] = useState<string | null>(null);
  const [editIssueDate, setEditIssueDate] = useState('');
  const [editExpiryDate, setEditExpiryDate] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editMetadata, setEditMetadata] = useState<Record<string, string>>({});
  const [editAutoDelete, setEditAutoDelete] = useState<string | null>(null);
  const [editImageUri, setEditImageUri] = useState<string | null>(null);
  const [editLocalPath, setEditLocalPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fullscreenUri, setFullscreenUri] = useState<string | null>(null);
  const [typePickerVisible, setTypePickerVisible] = useState(false);
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
  }, [id]);

  const openEditModal = () => {
    if (!doc) return;
    setEditType(doc.type);
    setEditCustomTypeId(doc.custom_type_id ?? null);
    setEditIssueDate(doc.issue_date ?? '');
    setEditExpiryDate(doc.expiry_date ?? '');
    setEditNote(doc.note ?? '');
    setEditMetadata(doc.metadata ?? {});
    const fp = doc.file_path;
    setEditImageUri(fp ? (fp.startsWith('file://') ? fp : `file://${fp}`) : null);
    setEditLocalPath(fp ?? null);
    setEditAutoDelete(doc.auto_delete ?? null);
    setEditVisible(true);
  };

  async function takeEditPhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisiune', 'Este nevoie de acces la cameră.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setEditImageUri(uri);
      const filename = `doc_${Date.now()}.jpg`;
      const dir = `${FileSystem.documentDirectory}documents`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const dest = `${dir}/${filename}`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      setEditLocalPath(dest);
    }
  }

  function handlePickEditPhoto() {
    Alert.alert('Alege sursă', '', [
      { text: 'Cameră', onPress: takeEditPhoto },
      { text: 'Galerie', onPress: pickEditImage },
      { text: 'Anulare', style: 'cancel' },
    ]);
  }

  async function pickEditImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisiune', 'Este nevoie de acces la galerie.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      setEditImageUri(uri);
      const filename = `doc_${Date.now()}.jpg`;
      const dir = `${FileSystem.documentDirectory}documents`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const dest = `${dir}/${filename}`;
      await FileSystem.copyAsync({ from: uri, to: dest });
      setEditLocalPath(dest);
    }
  }

  const allPages = useMemo(() => {
    if (!doc) return [];
    const main = doc.file_path ? [{ id: '__main__', file_path: doc.file_path }] : [];
    const extra = (doc.pages ?? []).map(p => ({ id: p.id, file_path: p.file_path }));
    return [...main, ...extra];
  }, [doc]);

  function getDisplayUri(filePath: string): string {
    return (
      rotatedUris[filePath] ?? (filePath.startsWith('file://') ? filePath : `file://${filePath}`)
    );
  }

  async function handleRotate(filePath: string, degrees: number) {
    const sourceUri = getDisplayUri(filePath);
    try {
      const result = await ImageManipulator.manipulateAsync(sourceUri, [{ rotate: degrees }], {
        compress: 0.9,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      setRotatedUris(prev => ({ ...prev, [filePath]: result.uri }));
      const dest = filePath.startsWith('file://') ? filePath.slice(7) : filePath;
      await FileSystem.copyAsync({ from: result.uri, to: dest });
    } catch {
      Alert.alert('Eroare', 'Nu s-a putut roti imaginea.');
    }
  }

  async function handleDeletePage(pageId: string, filePath: string) {
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
            setRotatedUris(prev => {
              const next = { ...prev };
              delete next[filePath];
              return next;
            });
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
      const dir = `${FileSystem.documentDirectory}documents`;
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const dest = `${dir}/${filename}`;
      // Normalizează EXIF (bake-in rotația) înainte de salvare
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
          file_path: dest,
          auto_delete: doc.auto_delete,
        });
      } else {
        await addDocumentPage(doc.id, dest);
      }
      const updated = await getDocumentById(doc.id);
      setDoc(updated);
      // Pasăm documentul actualizat la OCR ca să nu folosim closure-ul stale
      if (updated) runOcrOnNewPage(dest, updated);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut adăuga pagina');
    }
  }

  // Încearcă să găsească orientarea corectă a imaginii via OCR.
  // Dacă textul inițial e prea scurt, testează 90°/270°/180° și salvează versiunea cea mai bună.
  // Returnează textul extras și dacă imaginea a fost rotită.
  async function ocrWithAutoRotate(storedPath: string): Promise<{ text: string; rotated: boolean }> {
    const fileUri = storedPath.startsWith('file://') ? storedPath : `file://${storedPath}`;
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
      const destPath = storedPath.startsWith('file://') ? storedPath.slice(7) : storedPath;
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
      { text: 'Anulare', style: 'cancel' },
    ]);
  }

  const handleSave = async () => {
    if (!doc) return;
    setSaving(true);
    try {
      await updateDocument(doc.id, {
        type: editType,
        custom_type_id: editType === 'custom' ? (editCustomTypeId ?? undefined) : undefined,
        issue_date: editIssueDate.trim() || undefined,
        expiry_date: editExpiryDate.trim() || undefined,
        note: editNote.trim() || undefined,
        file_path: editLocalPath ?? undefined,
        metadata: Object.keys(editMetadata).length > 0 ? editMetadata : undefined,
        auto_delete: editAutoDelete ?? undefined,
      });
      const updated = await getDocumentById(doc.id);
      setDoc(updated);
      scheduleExpirationReminders().catch(() => {});
      setEditVisible(false);

      const finalExpiry = editExpiryDate.trim();
      if (finalExpiry && isCalendarAvailable()) {
        Alert.alert(
          'Adaugă în calendar?',
          `Vrei să adaugi un reminder în calendar pentru expirarea pe ${finalExpiry}?`,
          [
            { text: 'Nu', style: 'cancel' },
            {
              text: 'Adaugă',
              onPress: async () => {
                const calId = await addExpiryCalendarEvent({ docType: editType, expiryDate: finalExpiry, entityName: undefined, documentId: doc.id, note: editNote.trim() || undefined });
                if (!calId) Alert.alert('Eroare', 'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.');
              },
            },
          ]
        );
      }
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva');
    } finally {
      setSaving(false);
    }
  };

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

      const found: string[] = [];
      if (info.expiry_date) found.push(`📅 Expiră: ${info.expiry_date}`);
      if (info.issue_date) found.push(`📅 Emis: ${info.issue_date}`);
      if (info.name) found.push(`👤 Nume: ${info.name}`);
      if (info.cnp) found.push(`🔢 CNP: ${info.cnp}`);
      if (info.series) found.push(`🔠 Seria: ${info.series}`);

      const pageLabel = `${allPages.length} ${allPages.length === 1 ? 'pagină' : 'pagini'}`;
      const message = found.length > 0
        ? `Găsit din ${pageLabel}:\n\n${found.join('\n')}`
        : `Text extras din ${pageLabel}:\n\n${combinedText.slice(0, 400)}${combinedText.length > 400 ? '…' : ''}`;

      Alert.alert(
        'Procesare OCR',
        message,
        [
          { text: 'Închide', style: 'cancel' },
          found.length > 0
            ? {
                text: 'Aplică pe document',
                onPress: async () => {
                  await updateDocument(doc!.id, {
                    type: doc!.type,
                    issue_date: info.issue_date ?? doc!.issue_date,
                    expiry_date: info.expiry_date ?? doc!.expiry_date,
                    note: (!doc!.note && summary) ? summary : doc!.note,
                    file_path: doc!.file_path,
                    auto_delete: doc!.auto_delete,
                    metadata: doc!.metadata,
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
                  openEditModal();
                  setEditNote(combinedText.slice(0, 500));
                },
              },
        ]
      );
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
    if (doc.type === 'bilet' && doc.metadata?.event_date) {
      const title = [doc.metadata?.categorie, doc.metadata?.venue].filter(Boolean).join(' – ') || 'Eveniment';
      const calId = await addEventToCalendar({ title, eventDate: doc.metadata!.event_date, venue: doc.metadata?.venue, note: doc.note, documentId: doc.id });
      if (!calId) Alert.alert('Eroare', 'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.');
      else Alert.alert('Calendar', 'Reminder adăugat! Vei fi notificat cu 1 zi și 2 ore înainte.');
    } else if (doc.expiry_date) {
      const calId = await addExpiryCalendarEvent({ docType: doc.type, expiryDate: doc.expiry_date, entityName: undefined, documentId: doc.id, note: doc.note });
      if (!calId) Alert.alert('Eroare', 'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.');
      else Alert.alert('Calendar', 'Evenimentul a fost adăugat în calendar.');
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
    const fileUri = page.file_path.startsWith('file://')
      ? page.file_path
      : `file://${page.file_path}`;
    try {
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'image/jpeg',
          dialogTitle: `Distribuie: ${getDocumentLabel(doc!, customTypes)}`,
        });
      } else {
        await Share.share({ message: shareMessage(doc!), title: getDocumentLabel(doc!, customTypes) });
      }
    } catch (e) {
      if ((e as Error)?.message?.includes('cancel') || (e as Error)?.message === 'User cancelled') return;
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
    Alert.alert(
      'Distribuie imagine',
      'Alege pagina:',
      [
        ...allPages.map((_, idx) => ({
          text: `Pagina ${idx + 1}`,
          onPress: () => shareImageAtIndex(idx),
        })),
        { text: 'Anulare', style: 'cancel' as const },
      ]
    );
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
        const fileUri = page.file_path.startsWith('file://')
          ? page.file_path
          : `file://${page.file_path}`;
        try {
          // Comprimă imaginea la max 1400px și calitate 75% — reduce dimensiunea de ~10x
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
          // imaginea nu a putut fi citită — continuăm cu restul paginilor
        }
      }
      if (imgTags.length === 0 && allPages.length > 0) {
        Alert.alert('Atenție', 'Imaginile nu au putut fi incluse în PDF. Va conține doar textul documentului.');
      }

      const docLabel = escapeHtml(getDocumentLabel(doc, customTypes));
      const generatedDate = new Date().toLocaleDateString('ro-RO', { day: '2-digit', month: 'long', year: 'numeric' });

      // Câmpuri metadata
      const metaFields: string[] = [];
      if (doc.issue_date) metaFields.push(`
        <div class="field">
          <div class="field-label">Data emisiunii</div>
          <div class="field-value">${escapeHtml(doc.issue_date)}</div>
        </div>`);
      if (doc.expiry_date) metaFields.push(`
        <div class="field">
          <div class="field-label">Data expirării</div>
          <div class="field-value">${escapeHtml(doc.expiry_date)}</div>
        </div>`);
      if (doc.metadata) {
        const { DOCUMENT_FIELDS } = require('@/types/documentFields');
        const fields = DOCUMENT_FIELDS[doc.type] ?? [];
        for (const f of fields) {
          const val = doc.metadata[f.key];
          if (val) metaFields.push(`
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
    border-bottom: 2px solid #9EB567;
    margin-bottom: 6mm;
  }
  .meta-brand { font-size: 16px; font-weight: 800; color: #9EB567; }
  .meta-brand-sub { font-size: 9px; color: #aaa; margin-top: 1px; }
  .meta-doc-type { font-size: 24px; font-weight: 700; margin-bottom: 6mm; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-bottom: 4mm; }
  .field {
    background: #f8faf4; border: 1px solid #e2ebd4;
    border-radius: 6px; padding: 3mm 4mm;
  }
  .field-label {
    font-size: 8px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #9EB567; margin-bottom: 1.5mm;
  }
  .field-value { font-size: 13px; font-weight: 500; }
  .note-box {
    background: #f8faf4; border: 1px solid #e2ebd4;
    border-left: 3px solid #9EB567;
    border-radius: 0 6px 6px 0; padding: 3mm 4mm; margin-bottom: 6mm;
  }
  .note-label {
    font-size: 8px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; color: #9EB567; margin-bottom: 1.5mm;
  }
  .note-value { font-size: 12px; color: #444; line-height: 1.6; }
  .meta-footer {
    margin-top: 8mm; padding-top: 3mm;
    border-top: 0.5px solid #e2ebd4;
    display: flex; justify-content: space-between;
    font-size: 8px; color: #bbb;
  }
  .meta-footer-brand { color: #9EB567; font-weight: 700; }

  /* Pagina OCR */
  .ocr-page {
    page-break-before: always;
    padding: 12mm;
  }
  .ocr-title { font-size: 18px; font-weight: 700; margin-bottom: 5mm; color: #1e2318; }
  .ocr-content {
    font-size: 10.5px; line-height: 1.7; color: #333;
    white-space: pre-wrap;
    font-family: 'Courier New', Courier, monospace;
    background: #f8faf4; border: 1px solid #e2ebd4;
    border-radius: 6px; padding: 4mm;
  }
</style></head><body>

  ${imgTags.join('\n')}

  <div class="meta-page">
    <div class="meta-header">
      <div>
        <div class="meta-brand">Portofel Acte</div>
        <div class="meta-brand-sub">Aplicație de gestionare documente personale</div>
      </div>
    </div>
    <div class="meta-doc-type">${docLabel}</div>
    ${metaFields.length > 0 ? `<div class="fields">${metaFields.join('')}</div>` : ''}
    ${doc.note ? `<div class="note-box"><div class="note-label">Notă</div><div class="note-value">${escapeHtml(doc.note)}</div></div>` : ''}
    <div class="meta-footer">
      <span class="meta-footer-brand">Portofel Acte</span>
      <span>tudorabrudan.github.io/Portofel_Documente • Generat pe ${generatedDate}</span>
    </div>
  </div>

  ${doc.ocr_text ? `
  <div class="ocr-page">
    <div class="meta-header">
      <div>
        <div class="meta-brand">Portofel Acte</div>
        <div class="meta-brand-sub">Text identificat automat prin OCR</div>
      </div>
    </div>
    <div class="ocr-title">Text extras din document</div>
    <div class="ocr-content">${escapeHtml(doc.ocr_text)}</div>
    <div class="meta-footer" style="margin-top:6mm">
      <span class="meta-footer-brand">Portofel Acte</span>
      <span>tudorabrudan.github.io/Portofel_Documente • Generat pe ${generatedDate}</span>
    </div>
  </div>` : ''}

</body></html>`;
      const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 }); // A4 in points
      const available = await Sharing.isAvailableAsync();
      if (available)
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Exportă ca PDF',
        });
      else await Share.share({ message: 'PDF generat', url: uri, title: 'Document PDF' });
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

  if (loading || !doc) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{loading ? 'Se încarcă...' : 'Document negăsit'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {allPages.map((page, idx) => (
          <View key={page.id + idx} style={styles.imageWrap}>
            {allPages.length > 1 && (
              <Text style={styles.pageLabel}>
                Pagina {idx + 1} / {allPages.length}
              </Text>
            )}
            <View style={styles.imageContainer}>
              <Image
                source={{ uri: getDisplayUri(page.file_path) }}
                style={styles.image}
                resizeMode="contain"
              />
              <Pressable
                style={styles.fullscreenBtn}
                onPress={() => setFullscreenUri(getDisplayUri(page.file_path))}
              >
                <Text style={styles.fullscreenBtnText}>⤢</Text>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.rotateBar}
              contentContainerStyle={styles.rotateBarContent}
            >
              <Pressable style={styles.rotateBtn} onPress={() => handleRotate(page.file_path, -90)}>
                <Text style={styles.rotateBtnText}>↺ Stânga</Text>
              </Pressable>
              <Pressable style={styles.rotateBtn} onPress={() => handleRotate(page.file_path, 90)}>
                <Text style={styles.rotateBtnText}>Dreapta ↻</Text>
              </Pressable>
              <Pressable
                style={styles.rotateBtn}
                onPress={() => handleDeletePage(page.id, page.file_path)}
              >
                <Text style={[styles.rotateBtnText, { color: '#c00' }]}>Șterge</Text>
              </Pressable>
            </ScrollView>
          </View>
        ))}
        <Pressable style={styles.addPageBtn} onPress={handleAddPage}>
          <Text style={styles.addPageBtnText}>
            {allPages.length === 0 ? '+ Adaugă poză / pagină' : '+ Adaugă pagină'}
          </Text>
        </Pressable>
        {allPages.length > 0 && (
          <Pressable
            style={[styles.ocrBtn, ocrLoading && styles.btnDisabled]}
            onPress={handleOcr}
            disabled={ocrLoading}
          >
            {ocrLoading ? (
              <ActivityIndicator color={primary} />
            ) : (
              <Text style={styles.ocrBtnText}>
                🔍 Procesare OCR {allPages.length > 1 ? `(${allPages.length} pagini)` : ''}
              </Text>
            )}
          </Pressable>
        )}
        <View style={styles.meta}>
          <Text style={styles.label}>Tip</Text>
          <Text style={styles.value}>{getDocumentLabel(doc, customTypes)}</Text>
          {(() => {
            let entityName: string | null = null;
            if (doc.person_id) entityName = persons.find(p => p.id === doc.person_id)?.name ?? null;
            else if (doc.property_id) entityName = properties.find(p => p.id === doc.property_id)?.name ?? null;
            else if (doc.vehicle_id) entityName = vehicles.find(v => v.id === doc.vehicle_id)?.name ?? null;
            else if (doc.card_id) {
              const c = cards.find(c => c.id === doc.card_id);
              entityName = c ? `${c.nickname ?? ''} ····${c.last4}`.trim() : null;
            } else if (doc.animal_id) entityName = animals.find(a => a.id === doc.animal_id)?.name ?? null;
            else if (doc.company_id) entityName = companies.find(c => c.id === doc.company_id)?.name ?? null;
            if (!entityName) return null;
            return (
              <>
                <Text style={styles.label}>Legat de</Text>
                <Text style={styles.value}>{entityName}</Text>
              </>
            );
          })()}
          {doc.issue_date && (
            <>
              <Text style={styles.label}>Data emisiune</Text>
              <Text style={styles.value}>{doc.issue_date}</Text>
            </>
          )}
          {doc.expiry_date && (
            <>
              <Text style={styles.label}>Data expirare</Text>
              <Text style={styles.value}>{doc.expiry_date}</Text>
              <Pressable
                style={[styles.calendarBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={handleCalendar}
              >
                <Text style={styles.actionItemIcon}>📅</Text>
                <Text style={[styles.actionItemLabel, { color: primary }]}>Adaugă reminder în calendar</Text>
              </Pressable>
            </>
          )}
          {doc.note && (
            <>
              <Text style={styles.label}>Notă</Text>
              <Text style={styles.value}>{doc.note}</Text>
            </>
          )}
          {doc.auto_delete && (
            <>
              <Text style={styles.label}>Auto-ștergere</Text>
              <Text style={styles.value}>{autoDeleteLabel(doc.auto_delete)}</Text>
            </>
          )}
          {(DOCUMENT_FIELDS[doc.type] ?? []).map((field: FieldDef) => {
            const val = doc.metadata?.[field.key];
            if (!val) return null;
            return (
              <View key={field.key}>
                <Text style={styles.label}>{field.label}</Text>
                <Text style={styles.value}>{val}</Text>
              </View>
            );
          })}
          {doc.type === 'bilet' && doc.metadata?.event_date && (
            <Pressable
              style={[styles.calendarBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={handleCalendar}
            >
              <Text style={styles.actionItemIcon}>📅</Text>
              <Text style={[styles.actionItemLabel, { color: primary }]}>Reminder eveniment în calendar</Text>
            </Pressable>
          )}
        </View>

        {/* Butoane acțiuni — grid 2×2 compact */}
        <View style={[styles.actionBar, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Pressable
            style={[styles.actionItem, { borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border }, pdfLoading && styles.btnDisabled]}
            onPress={handleExportPdf}
            disabled={pdfLoading}
          >
            {pdfLoading
              ? <ActivityIndicator color={primary} size="small" />
              : <Text style={styles.actionItemIcon}>📄</Text>}
            <Text style={[styles.actionItemLabel, { color: primary }]}>Distribuie PDF</Text>
          </Pressable>
          <Pressable
            style={[styles.actionItem, { borderBottomWidth: 1, borderColor: colors.border }]}
            onPress={handleShare}
          >
            <Text style={styles.actionItemIcon}>📤</Text>
            <Text style={[styles.actionItemLabel, { color: colors.text }]}>Distribuie</Text>
          </Pressable>
          <Pressable
            style={[styles.actionItem, { borderRightWidth: 1, borderColor: colors.border }]}
            onPress={openEditModal}
          >
            <Text style={styles.actionItemIcon}>✏️</Text>
            <Text style={[styles.actionItemLabel, { color: primary }]}>Editează</Text>
          </Pressable>
          <Pressable style={styles.actionItem} onPress={handleDelete}>
            <Text style={styles.actionItemIcon}>🗑️</Text>
            <Text style={[styles.actionItemLabel, styles.actionItemDanger]}>Șterge</Text>
          </Pressable>
        </View>
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

      {editVisible && (
        <View style={styles.overlay}>
          <View style={[styles.overlayBox, { backgroundColor: colors.card }]}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.overlayTitle}>Editează document</Text>

              <Text style={styles.fieldLabel}>Poză / scan (opțional)</Text>
              {editImageUri ? (
                <View style={styles.editImageWrap}>
                  <Image
                    source={{ uri: editImageUri }}
                    style={styles.editImagePreview}
                    resizeMode="contain"
                  />
                  <Pressable
                    onPress={() => {
                      setEditImageUri(null);
                      setEditLocalPath(null);
                    }}
                    style={styles.removePhotoBtn}
                  >
                    <Text style={styles.removePhotoBtnText}>Șterge poza</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={[styles.overlayBtn, styles.overlayBtnOutline, styles.pickPhotoBtn]}
                  onPress={handlePickEditPhoto}
                  disabled={saving}
                >
                  <Text style={styles.overlayBtnOutlineText}>Alege poză</Text>
                </Pressable>
              )}

              <Text style={styles.fieldLabel}>Tip document</Text>
              <Pressable
                style={styles.typeToggleRow}
                onPress={() => setTypePickerVisible(v => !v)}
              >
                <Text style={styles.typeToggleCurrent}>
                  {editType === 'custom'
                    ? (customTypes.find(c => c.id === editCustomTypeId)?.name ?? 'Tip personalizat')
                    : (DOCUMENT_TYPE_LABELS[editType] ?? editType)}
                </Text>
                <Text style={styles.typeToggleChevron}>{typePickerVisible ? '▲' : '▼ Schimbă'}</Text>
              </Pressable>
              {typePickerVisible && (
                <View style={styles.typeRow}>
                  {standardTypes.map(({ value, label }) => (
                    <Pressable
                      key={value}
                      style={[styles.typeChip, editType === value && styles.typeChipActive]}
                      onPress={() => { setEditType(value); setEditCustomTypeId(null); setTypePickerVisible(false); }}
                    >
                      <Text
                        style={[styles.typeChipText, editType === value && styles.typeChipTextActive]}
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
                        editType === 'custom' && editCustomTypeId === ct.id && styles.typeChipActive,
                      ]}
                      onPress={() => { setEditType('custom'); setEditCustomTypeId(ct.id); setTypePickerVisible(false); }}
                    >
                      <Text
                        style={[
                          styles.typeChipText,
                          editType === 'custom' && editCustomTypeId === ct.id && styles.typeChipTextActive,
                        ]}
                      >
                        {ct.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <DatePickerField
                label="Data emisiune (opțional)"
                value={editIssueDate}
                onChange={setEditIssueDate}
                disabled={saving}
              />
              <DatePickerField
                label="Data expirare (opțional)"
                value={editExpiryDate}
                onChange={setEditExpiryDate}
                disabled={saving}
              />

              <Text style={styles.fieldLabel}>Auto-ștergere (opțional)</Text>
              <View style={styles.typeRow}>
                {([
                  { label: 'Niciodată', value: null },
                  { label: '30 zile', value: '30d' },
                  { label: '90 zile', value: '90d' },
                  { label: '180 zile', value: '180d' },
                  { label: '1 an', value: '365d' },
                  ...(editExpiryDate ? [{ label: 'La expirare', value: 'expiry' }] : []),
                ] as { label: string; value: string | null }[]).map(opt => (
                  <Pressable
                    key={opt.value ?? 'never'}
                    style={[styles.typeChip, editAutoDelete === opt.value && styles.typeChipActive]}
                    onPress={() => setEditAutoDelete(opt.value)}
                  >
                    <Text style={[styles.typeChipText, editAutoDelete === opt.value && styles.typeChipTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Notă (opțional)</Text>
              <ThemedTextInput
                style={[styles.input, styles.inputMultiline]}
                placeholder="Notă"
                value={editNote}
                onChangeText={setEditNote}
                multiline
                editable={!saving}
              />

              {/* Câmpuri specifice tipului */}
              {(DOCUMENT_FIELDS[editType] ?? []).map((field: FieldDef) => (
                <View key={field.key}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <ThemedTextInput
                    style={styles.input}
                    placeholder={field.placeholder ?? ''}
                    value={editMetadata[field.key] ?? ''}
                    onChangeText={v => setEditMetadata(prev => ({ ...prev, [field.key]: v }))}
                    keyboardType={field.keyboardType ?? 'default'}
                    editable={!saving}
                  />
                </View>
              ))}

              <View style={styles.overlayBtns}>
                <Pressable
                  style={[styles.overlayBtn, styles.overlayBtnOutline]}
                  onPress={() => setEditVisible(false)}
                  disabled={saving}
                >
                  <Text style={styles.overlayBtnOutlineText}>Anulează</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.overlayBtn,
                    styles.overlayBtnPrimary,
                    saving && styles.btnDisabled,
                  ]}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.overlayBtnPrimaryText}>Salvează</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  muted: { opacity: 0.7 },
  imageWrap: {
    marginBottom: 20,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
  },
  imageContainer: { position: 'relative' },
  image: { width: '100%', height: 280, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  fullscreenBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullscreenBtnText: { color: '#fff', fontSize: 18, lineHeight: 22 },
  // Fullscreen modal
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
  rotateBar: {
    backgroundColor: '#f8f8f8',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  rotateBarContent: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 4,
  },
  rotateBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#eee',
  },
  rotateBtnText: {
    fontSize: 13,
    color: primary,
    fontWeight: '500',
  },
  pageLabel: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    paddingHorizontal: 8,
    paddingTop: 8,
    textAlign: 'center',
  },
  addPageBtn: {
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  addPageBtnText: { color: primary, fontSize: 15, fontWeight: '500' },
  meta: { marginBottom: 24 },
  label: { fontSize: 12, opacity: 0.7, marginTop: 12, marginBottom: 2 },
  value: { fontSize: 16 },
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
  typeToggleCurrent: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  typeToggleChevron: {
    fontSize: 13,
    color: '#9EB567',
    fontWeight: '500',
  },
  actionBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  actionItem: {
    width: '50%',
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  actionItemFull: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionItemIcon: { fontSize: 20 },
  actionItemLabel: { fontSize: 12, fontWeight: '600' },
  actionItemDanger: { color: '#c00' },
  btnDisabled: { opacity: 0.7 },
  asigraBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#9EB567',
  },
  asigaBtnText: { color: '#2E7D32', fontSize: 14, fontWeight: '600' },
  // Edit overlay
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  overlayBox: {
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxHeight: '92%',
  },
  overlayTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16 },
  fieldLabel: { fontSize: 14, marginBottom: 6, opacity: 0.9 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
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
    marginBottom: 16,
  },
  inputMultiline: { minHeight: 80 },
  editImageWrap: { marginBottom: 16 },
  editImagePreview: {
    width: '100%',
    height: 160,
    borderRadius: 12,
    backgroundColor: '#f0f0f0',
  },
  removePhotoBtn: { marginTop: 6 },
  removePhotoBtnText: { color: '#c00', fontSize: 14 },
  pickPhotoBtn: { marginBottom: 16 },
  overlayBtns: { flexDirection: 'row', gap: 8, marginTop: 8 },
  overlayBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  overlayBtnOutline: {
    borderWidth: 1,
    borderColor: primary,
  },
  overlayBtnOutlineText: { color: primary, fontSize: 16, fontWeight: '500' },
  overlayBtnPrimary: { backgroundColor: primary },
  overlayBtnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  ocrBtn: {
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  ocrBtnText: { color: primary, fontSize: 16, fontWeight: '500' },
});
