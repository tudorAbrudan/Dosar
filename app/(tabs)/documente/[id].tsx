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
} from '@/services/documents';
import { scheduleExpirationReminders } from '@/services/notifications';
import { addExpiryCalendarEvent, addEventToCalendar, isCalendarAvailable } from '@/services/calendar';
import { extractText, extractDocumentInfo, detectDocumentType, formatOcrSummary } from '@/services/ocr';
import { DOCUMENT_TYPE_LABELS, getDocumentLabel } from '@/types';
import type { Document as DocType, DocumentType } from '@/types';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { useFilteredDocTypes } from '@/hooks/useFilteredDocTypes';
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
      await FileSystem.copyAsync({ from: uri, to: dest });
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

  async function runOcrOnNewPage(localPath: string, currentDoc: DocType) {
    try {
      const fileUri = localPath.startsWith('file://') ? localPath : `file://${localPath}`;
      const { text } = await extractText(fileUri);
      if (!text.trim()) return;

      const detectedType = detectDocumentType(text);
      const info = extractDocumentInfo(text);
      const summary = formatOcrSummary(text, info);

      // Folosim currentDoc (actualizat), nu doc din closure (stale)
      const updates: Parameters<typeof updateDocument>[1] = {
        type: (detectedType && detectedType !== 'altul' && detectedType !== 'custom') ? detectedType : currentDoc.type,
        issue_date: info.issue_date ?? currentDoc.issue_date,
        expiry_date: info.expiry_date ?? currentDoc.expiry_date,
        note: (!currentDoc.note && summary) ? summary : currentDoc.note,
        file_path: currentDoc.file_path,
        auto_delete: currentDoc.auto_delete,
      };
      await updateDocument(currentDoc.id, updates);
      const updated = await getDocumentById(currentDoc.id);
      setDoc(updated);
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
    const firstPage = allPages[0];
    if (!firstPage) {
      Alert.alert('Fără imagine', 'Nu există o imagine atașată acestui document.');
      return;
    }
    const currentImageUri = firstPage.file_path.startsWith('file://')
      ? firstPage.file_path
      : `file://${firstPage.file_path}`;
    setOcrLoading(true);
    try {
      const { text } = await extractText(currentImageUri);
      if (!text.trim()) {
        Alert.alert('OCR', 'Nu s-a putut extrage text din imagine.');
        return;
      }
      Alert.alert('Text extras', text.slice(0, 500) + (text.length > 500 ? '...' : ''), [
        { text: 'Închide', style: 'cancel' },
        {
          text: 'Copiază în notă',
          onPress: () => {
            openEditModal();
            setEditNote(text.slice(0, 500));
          },
        },
      ]);
    } catch (e) {
      Alert.alert('Eroare OCR', e instanceof Error ? e.message : 'Eroare la procesare');
    } finally {
      setOcrLoading(false);
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
      const lines: string[] = [`<p><strong>${getDocumentLabel(doc, customTypes)}</strong></p>`];
      if (doc.issue_date) lines.push(`<p>Emis: ${doc.issue_date}</p>`);
      if (doc.expiry_date) lines.push(`<p>Expiră: ${doc.expiry_date}</p>`);
      if (doc.note) lines.push(`<p>${escapeHtml(doc.note)}</p>`);
      const html = `
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"><style>
          @page { margin: 10mm; size: A4 portrait; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: sans-serif; }
          .img-page {
            width: 100%;
            height: 277mm;
            display: flex;
            align-items: center;
            justify-content: center;
            page-break-after: always;
            page-break-inside: avoid;
          }
          .img-page img {
            max-width: 100%;
            max-height: 277mm;
            object-fit: contain;
          }
          .meta { padding: 16px; }
          .meta p { margin: 4px 0; font-size: 13px; line-height: 1.5; }
        </style></head><body>
          ${imgTags.join('\n')}
          ${lines.length > 0 ? `<div class="meta">${lines.join('')}</div>` : ''}
        </body></html>
      `;
      const { uri } = await Print.printToFileAsync({ html });
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
        <View style={styles.meta}>
          <Text style={styles.label}>Tip</Text>
          <Text style={styles.value}>{getDocumentLabel(doc, customTypes)}</Text>
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
                style={styles.calendarBtn}
                onPress={async () => {
                  if (!isCalendarAvailable()) {
                    Alert.alert('Calendar indisponibil', 'Calendarul necesită un build nativ (expo run:ios). Nu funcționează în Expo Go.');
                    return;
                  }
                  const calId = await addExpiryCalendarEvent({
                    docType: doc.type,
                    expiryDate: doc.expiry_date!,
                    entityName: undefined,
                    documentId: doc.id,
                    note: doc.note,
                  });
                  if (!calId)
                    Alert.alert('Eroare', 'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.');
                  else
                    Alert.alert('Calendar', 'Evenimentul a fost adăugat în calendar.');
                }}
              >
                <Text style={styles.calendarBtnText}>📅 Adaugă reminder în calendar</Text>
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
              style={styles.calendarBtn}
              onPress={async () => {
                if (!isCalendarAvailable()) {
                  Alert.alert('Calendar indisponibil', 'Calendarul necesită un build nativ (expo run:ios).');
                  return;
                }
                const title = [doc.metadata?.categorie, doc.metadata?.venue].filter(Boolean).join(' – ') || 'Eveniment';
                const calId = await addEventToCalendar({
                  title,
                  eventDate: doc.metadata!.event_date,
                  venue: doc.metadata?.venue,
                  note: doc.note,
                  documentId: doc.id,
                });
                if (!calId)
                  Alert.alert('Eroare', 'Nu s-a putut accesa calendarul. Verifică permisiunile în Setări.');
                else
                  Alert.alert('Calendar', 'Reminder adăugat! Vei fi notificat cu 1 zi și 2 ore înainte.');
              }}
            >
              <Text style={styles.calendarBtnText}>📅 Reminder eveniment în calendar</Text>
            </Pressable>
          )}
        </View>

        <Pressable style={styles.editBtn} onPress={openEditModal}>
          <Text style={styles.editBtnText}>Editează</Text>
        </Pressable>

        <Pressable
          style={[styles.shareBtn, pdfLoading && styles.btnDisabled]}
          onPress={handleExportPdf}
          disabled={pdfLoading}
        >
          {pdfLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.shareBtnText}>Exportă ca PDF (apoi partajează)</Text>
          )}
        </Pressable>
        <Pressable style={styles.shareBtnSecondary} onPress={handleShare}>
          <Text style={styles.shareBtnTextSecondary}>
            Distribuie imaginea (Email, WhatsApp, etc.)
          </Text>
        </Pressable>
        <Pressable
          style={[styles.ocrBtn, (ocrLoading || allPages.length === 0) && styles.btnDisabled]}
          onPress={handleOcr}
          disabled={ocrLoading || allPages.length === 0}
        >
          {ocrLoading ? (
            <ActivityIndicator color={primary} />
          ) : (
            <Text style={styles.ocrBtnText}>Extrage text (OCR)</Text>
          )}
        </Pressable>
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
        <Pressable style={styles.deleteBtn} onPress={handleDelete}>
          <Text style={styles.deleteBtnText}>Șterge document</Text>
        </Pressable>
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
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#9EB567',
    alignSelf: 'flex-start',
  },
  calendarBtnText: {
    fontSize: 13,
    color: '#2E7D32',
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
  editBtn: {
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  editBtnText: { color: primary, fontSize: 16, fontWeight: '500' },
  shareBtn: {
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  btnDisabled: { opacity: 0.7 },
  shareBtnText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  shareBtnSecondary: {
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  shareBtnTextSecondary: { color: primary, fontSize: 16, fontWeight: '500' },
  asigraBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#9EB567',
  },
  asigaBtnText: { color: '#2E7D32', fontSize: 15, fontWeight: '600' },
  deleteBtn: {
    borderWidth: 1,
    borderColor: '#c00',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  deleteBtnText: { color: '#c00', fontSize: 16 },
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
