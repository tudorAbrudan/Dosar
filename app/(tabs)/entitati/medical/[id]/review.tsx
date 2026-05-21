import { useState, useCallback, useMemo } from 'react';
import {
  View,
  FlatList,
  Pressable,
  Alert,
  StyleSheet,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, onPrimary, statusColors } from '@/theme/colors';
import { useObservationsForReview } from '@/hooks/useMedicalObservations';
import { updateObservation, deleteObservation } from '@/services/medicalObservations';
import type { MedicalObservation } from '@/types';

export default function ReviewObservationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const { observations, loading, refresh } = useObservationsForReview(id ?? null);
  const [editing, setEditing] = useState<MedicalObservation | null>(null);

  const confirmObs = useCallback(
    async (o: MedicalObservation) => {
      try {
        await updateObservation(o.id, { needs_review: false, user_corrected: true });
        await refresh();
      } catch (e) {
        Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut confirma.');
      }
    },
    [refresh]
  );

  const removeObs = useCallback(
    (o: MedicalObservation) => {
      Alert.alert('Șterge observația', `Sigur ștergi „${o.name}: ${o.value ?? '?'}"?`, [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteObservation(o.id);
              await refresh();
            } catch (e) {
              Alert.alert('Eroare', e instanceof Error ? e.message : 'Ștergerea a eșuat.');
            }
          },
        },
      ]);
    },
    [refresh]
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Stack.Screen options={{ title: 'Verifică observații', headerBackTitle: 'Înapoi' }} />

      <FlatList
        data={observations}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingVertical: 8 }}
        refreshing={loading}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <View
            style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}
          >
            <View style={styles.cardHeader}>
              <Ionicons name="warning-outline" size={18} color={statusColors.warning} />
              <Text style={[styles.title, { color: palette.text }]}>
                {item.name}: {item.value ?? '—'}
                {item.unit ? ` ${item.unit}` : ''}
              </Text>
            </View>
            <Text style={[styles.meta, { color: palette.textSecondary }]}>
              {item.observed_at ?? 'fără dată'} · confidence {Math.round(item.confidence * 100)}%
              {item.ref_min || item.ref_max
                ? ` · ref ${item.ref_min ?? '?'}–${item.ref_max ?? '?'}`
                : ''}
            </Text>
            <View style={styles.btnRow}>
              <Pressable
                style={[styles.btnPrimary, { backgroundColor: primary }]}
                onPress={() => confirmObs(item)}
              >
                <Ionicons name="checkmark" size={16} color={onPrimary} />
                <Text style={[styles.btnPrimaryText, { color: onPrimary }]}>Confirmă</Text>
              </Pressable>
              <Pressable
                style={[styles.btnSecondary, { borderColor: palette.border }]}
                onPress={() => setEditing(item)}
              >
                <Ionicons name="create-outline" size={16} color={palette.text} />
                <Text style={[styles.btnSecondaryText, { color: palette.text }]}>Corectează</Text>
              </Pressable>
              <Pressable
                style={[styles.btnSecondary, { borderColor: palette.border }]}
                onPress={() => removeObs(item)}
              >
                <Ionicons name="trash-outline" size={16} color={statusColors.critical} />
                <Text style={[styles.btnSecondaryText, { color: statusColors.critical }]}>
                  Șterge
                </Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-done-outline" size={48} color={primary} />
              <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
                Nicio observație de verificat.
              </Text>
            </View>
          ) : null
        }
      />

      <EditObservationSheet
        observation={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await refresh();
        }}
      />
    </View>
  );
}

interface EditSheetProps {
  observation: MedicalObservation | null;
  onClose(): void;
  onSaved(): Promise<void>;
}

function EditObservationSheet({ observation, onClose, onSaved }: EditSheetProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const [refMin, setRefMin] = useState('');
  const [refMax, setRefMax] = useState('');
  const [observedAt, setObservedAt] = useState('');
  const [saving, setSaving] = useState(false);

  useMemo(() => {
    if (observation) {
      setName(observation.name);
      setValue(observation.value ?? '');
      setUnit(observation.unit ?? '');
      setRefMin(observation.ref_min ?? '');
      setRefMax(observation.ref_max ?? '');
      setObservedAt(observation.observed_at ?? '');
    }
  }, [observation]);

  if (!observation) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateObservation(observation.id, {
        name: name.trim() || observation.name,
        value: value.trim() === '' ? null : value.trim(),
        unit: unit.trim() === '' ? null : unit.trim(),
        ref_min: refMin.trim() === '' ? null : refMin.trim(),
        ref_max: refMax.trim() === '' ? null : refMax.trim(),
        observed_at: observedAt.trim() === '' ? null : observedAt.trim(),
        needs_review: false,
        user_corrected: true,
        confidence: 1,
      });
      await onSaved();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Salvarea a eșuat.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={true}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={saving ? () => {} : onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.modalContainer, { backgroundColor: palette.background }]}
      >
        <View style={[styles.modalHeader, { borderBottomColor: palette.border }]}>
          <Pressable onPress={onClose} disabled={saving}>
            <Text style={{ color: palette.textSecondary, fontSize: 15 }}>Anulează</Text>
          </Pressable>
          <Text style={[styles.modalTitle, { color: palette.text }]}>Corectează</Text>
          <Pressable onPress={handleSave} disabled={saving}>
            <Text style={{ color: primary, fontSize: 15, fontWeight: '600' }}>
              {saving ? 'Salvez...' : 'Salvează'}
            </Text>
          </Pressable>
        </View>

        <View style={{ padding: 16, gap: 12 }}>
          <Field label="Nume" value={name} onChange={setName} palette={palette} />
          <Field
            label="Valoare"
            value={value}
            onChange={setValue}
            palette={palette}
            keyboard="default"
          />
          <Field label="Unitate (ex: mg/dL)" value={unit} onChange={setUnit} palette={palette} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field label="Ref. min" value={refMin} onChange={setRefMin} palette={palette} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Ref. max" value={refMax} onChange={setRefMax} palette={palette} />
            </View>
          </View>
          <Field
            label="Data (YYYY-MM-DD)"
            value={observedAt}
            onChange={setObservedAt}
            palette={palette}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange(v: string): void;
  palette: typeof light;
  keyboard?: 'default' | 'numeric';
}

function Field({ label, value, onChange, palette, keyboard = 'default' }: FieldProps) {
  return (
    <View>
      <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={palette.textSecondary}
        keyboardType={keyboard}
        style={[
          styles.fieldInput,
          {
            color: palette.text,
            borderColor: palette.border,
            backgroundColor: palette.surface,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginVertical: 6, padding: 14, borderRadius: 12, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '600', flex: 1 },
  meta: { fontSize: 12, marginTop: 4 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  btnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnPrimaryText: { fontSize: 14, fontWeight: '600' },
  btnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  btnSecondaryText: { fontSize: 13 },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 24 },
  emptyText: { fontSize: 15, marginTop: 12, textAlign: 'center' },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 15, fontWeight: '600' },
  fieldLabel: { fontSize: 13, marginBottom: 4 },
  fieldInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
});
