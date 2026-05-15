/**
 * Secțiune colapsabilă „Text complet (OCR)" cu suport pentru editare manuală
 * a textului OCR. Folosită în DocumentPhotoSection (add/edit/[id]).
 */
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';

interface DocumentOcrTextSectionProps {
  ocrText?: string;
  pageCount: number;
  isEditing: boolean;
  scheme: 'light' | 'dark';
  onSave?: (text: string) => Promise<void>;
}

export function DocumentOcrTextSection({
  ocrText,
  pageCount,
  isEditing,
  scheme,
  onSave,
}: DocumentOcrTextSectionProps) {
  const C = Colors[scheme];
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  // Previne auto-save la onBlur când utilizatorul apasă "Anulare"
  const cancelledRef = useRef(false);

  async function handleSave() {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.section, { borderColor: C.border }]}>
      <Pressable
        onPress={() => {
          if (!editing) setExpanded(v => !v);
        }}
        style={styles.toggleRow}
      >
        <Text style={styles.toggleLabel}>Text complet (OCR)</Text>
        <View style={styles.toggleRight}>
          {isEditing && onSave && !editing && (
            <Pressable
              style={styles.editBtn}
              onPress={() => {
                setDraft(ocrText ?? '');
                setEditing(true);
                setExpanded(true);
              }}
            >
              <Ionicons name="create-outline" size={20} color={primary} />
            </Pressable>
          )}
          {!editing && (
            <Text style={styles.toggleChevron}>{expanded ? '▲ Ascunde' : '▼ Arată'}</Text>
          )}
        </View>
      </Pressable>
      {expanded && !editing && (
        <ScrollView style={[styles.scroll, { backgroundColor: C.background }]} nestedScrollEnabled>
          {ocrText && ocrText.length > 0 ? (
            <Text style={[styles.text, { color: C.text }]} selectable>
              {ocrText}
            </Text>
          ) : (
            <Text style={[styles.empty, { color: C.textSecondary }]}>
              Niciun text OCR.{' '}
              {pageCount > 0
                ? 'Apasă 🔍 OCR de mai sus pentru a extrage textul din imagini.'
                : 'Adaugă un fișier și rulează OCR pentru a extrage textul.'}
            </Text>
          )}
        </ScrollView>
      )}
      {expanded && editing && (
        <View style={{ backgroundColor: C.background }}>
          <TextInput
            style={[styles.input, { color: C.text, borderColor: C.border }]}
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            textAlignVertical="top"
            onBlur={() => {
              if (!cancelledRef.current && onSave) {
                onSave(draft).catch(() => {});
              }
              cancelledRef.current = false;
            }}
          />
          <View style={styles.actions}>
            <Pressable
              style={[styles.actionBtn, styles.cancelBtn, { borderColor: C.border }]}
              onPress={() => {
                cancelledRef.current = true;
                setEditing(false);
              }}
              disabled={saving}
            >
              <Text style={[styles.actionBtnText, { color: C.textSecondary }]}>Anulare</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.saveBtn, saving && styles.disabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Salvează</Text>
              )}
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 10, borderWidth: 1, marginBottom: 10, overflow: 'hidden' },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  toggleLabel: { fontSize: 14, opacity: 0.9, fontWeight: '500' },
  toggleRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toggleChevron: { color: primary, fontSize: 13, fontWeight: '500' },
  editBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  scroll: { maxHeight: 180, margin: 8, borderRadius: 8 },
  empty: { fontSize: 13, lineHeight: 18, fontStyle: 'italic', padding: 14 },
  text: { fontSize: 12, lineHeight: 18, opacity: 0.75, fontFamily: 'Courier', padding: 12 },
  input: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'Courier',
    padding: 12,
    minHeight: 80,
    maxHeight: 180,
    borderWidth: 1,
    borderRadius: 8,
    margin: 8,
  },
  actions: { flexDirection: 'row', gap: 8, padding: 8, paddingTop: 4 },
  actionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: { borderWidth: 1 },
  saveBtn: { backgroundColor: primary },
  actionBtnText: { fontSize: 14, fontWeight: '500' },
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
