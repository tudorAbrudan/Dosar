import { useState, useCallback, useEffect } from 'react';
import { View, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { DatePickerField } from '@/components/DatePickerField';
import { useColorScheme } from '@/components/useColorScheme';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { light, dark, primary } from '@/theme/colors';
import { addMedicalRecommendationCalendarEvent } from '@/services/calendar';
import { getDocumentById } from '@/services/documents';
import { getMedicalRecord } from '@/services/medicalRecord';
import { getDocumentLabel } from '@/types';
import type { ActionableItem } from '@/services/documents';

interface Props {
  visible: boolean;
  items: ActionableItem[];
  documentId: string;
  recordId: string;
  onClose: (decision: 'added' | 'skipped') => void;
}

interface ItemState {
  label: string;
  /** ISO YYYY-MM-DD sau '' dacă userul a șters data. */
  date: string;
  selected: boolean;
}

/**
 * Modal de confirmare pentru reminders extrase de AI din documentele medicale.
 * Lista vine deja filtrată (doar date viitoare, D14). Userul poate debifa
 * sau ajusta data fiecărui item, iar confirm-ul creează evenimente în calendar.
 */
export function MedicalRemindersModal({ visible, items, documentId, recordId, onClose }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const { customTypes } = useCustomTypes();

  const [states, setStates] = useState<ItemState[]>(() =>
    items.map(i => ({
      label: i.label,
      date: i.suggested_date_iso ?? '',
      selected: true,
    }))
  );
  const [saving, setSaving] = useState(false);

  // Re-sincronizează state când lista de items se schimbă (modal redeschis cu alt document).
  useEffect(() => {
    setStates(
      items.map(i => ({
        label: i.label,
        date: i.suggested_date_iso ?? '',
        selected: true,
      }))
    );
  }, [items]);

  const toggle = useCallback((idx: number) => {
    setStates(prev => prev.map((s, i) => (i === idx ? { ...s, selected: !s.selected } : s)));
  }, []);

  const setDate = useCallback((idx: number, date: string) => {
    setStates(prev => prev.map((s, i) => (i === idx ? { ...s, date } : s)));
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const toAdd = states.filter(s => s.selected && s.date !== '');
      if (toAdd.length === 0) {
        onClose('skipped');
        return;
      }

      const doc = await getDocumentById(documentId);
      const record = await getMedicalRecord(recordId);
      if (!doc || !record) {
        onClose('skipped');
        return;
      }

      let permissionDenied = false;
      for (const item of toAdd) {
        const eventId = await addMedicalRecommendationCalendarEvent({
          label: item.label,
          scheduledDate: item.date,
          sourceDocumentType: getDocumentLabel(doc, customTypes),
          sourceDocumentDate: doc.issue_date ?? null,
          recordName: record.name,
          documentId,
        });
        if (!eventId) {
          permissionDenied = true;
          break;
        }
      }

      if (permissionDenied) {
        Alert.alert(
          'Calendar indisponibil',
          'Activează permisiunile pentru Calendar în Setări iOS ca să adăugăm reminders.',
          [
            { text: 'Anulează', style: 'cancel', onPress: () => onClose('skipped') },
            {
              text: 'Deschide Setări',
              onPress: () => {
                Linking.openSettings();
                onClose('skipped');
              },
            },
          ]
        );
        return;
      }

      onClose('added');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-au putut adăuga reminders.');
      onClose('skipped');
    } finally {
      setSaving(false);
    }
  }, [states, documentId, recordId, customTypes, onClose]);

  return (
    <FormSheetModal
      visible={visible}
      title="Reminders din document medical"
      onClose={() => onClose('skipped')}
      onSave={handleSave}
      saving={saving}
    >
      <Text style={[styles.intro, { color: palette.textSecondary }]}>
        AI a detectat {items.length}{' '}
        {items.length === 1 ? 'recomandare cu termen' : 'recomandări cu termen'}. Bifează ce vrei să
        apară în calendar.
      </Text>

      {states.map((s, idx) => (
        <View key={idx} style={[styles.row, { borderColor: palette.border }]}>
          <Pressable
            onPress={() => toggle(idx)}
            style={styles.checkbox}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: s.selected }}
          >
            <Ionicons
              name={s.selected ? 'checkbox' : 'square-outline'}
              size={24}
              color={s.selected ? primary : palette.textSecondary}
            />
          </Pressable>
          <View style={styles.itemBody}>
            <Text style={[styles.label, { color: palette.text }]} numberOfLines={3}>
              {s.label}
            </Text>
            <View style={styles.dateWrap}>
              <DatePickerField
                label="Data reminder"
                value={s.date}
                onChange={d => setDate(idx, d)}
              />
            </View>
          </View>
        </View>
      ))}
    </FormSheetModal>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 13, marginBottom: 8, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  checkbox: { paddingTop: 2 },
  itemBody: { flex: 1 },
  label: { fontSize: 14, lineHeight: 20 },
  dateWrap: { marginTop: 8 },
});
