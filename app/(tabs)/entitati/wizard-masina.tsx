import { useState } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { primary, light, dark } from '@/theme/colors';
import { createVehicle } from '@/services/entities';
import { createDocument } from '@/services/documents';
import { scheduleExpirationReminders } from '@/services/notifications';
import type { DocumentType } from '@/types';

interface DocOption {
  type: DocumentType;
  label: string;
}

const DOC_OPTIONS: DocOption[] = [
  { type: 'talon', label: 'Talon' },
  { type: 'carte_auto', label: 'Carte auto' },
  { type: 'rca', label: 'RCA' },
  { type: 'itp', label: 'ITP' },
  { type: 'vigneta', label: 'Vignetă' },
];

export default function WizardMasinaScreen() {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<DocumentType>>(new Set());
  const [expiries, setExpiries] = useState<Partial<Record<DocumentType, string>>>({});
  const [loading, setLoading] = useState(false);

  function toggleDoc(type: DocumentType) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  function setExpiry(type: DocumentType, value: string) {
    setExpiries(prev => ({ ...prev, [type]: value }));
  }

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Eroare', 'Introdu numele mașinii.');
      return;
    }
    setLoading(true);
    try {
      const vehicle = await createVehicle(name.trim());
      for (const type of selected) {
        const expiry_date = expiries[type]?.trim() || undefined;
        await createDocument({ type, vehicle_id: vehicle.id, expiry_date });
      }
      await scheduleExpirationReminders();
      router.push(`/(tabs)/entitati/${vehicle.id}`);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {/* Step 1 */}
          <View style={styles.stepBlock}>
            <Text style={styles.stepTitle}>1. Numele mașinii</Text>
            <ThemedTextInput
              style={styles.input}
              placeholder="ex. Dacia Logan 2020"
              value={name}
              onChangeText={setName}
              editable={!loading}
            />
          </View>

          {/* Step 2 + 3 combined */}
          <View style={styles.stepBlock}>
            <Text style={styles.stepTitle}>2. Documente de adăugat</Text>
            <Text style={styles.hint}>
              Bifează documentele dorite și introdu data expirării (opțional).
            </Text>
            {DOC_OPTIONS.map(({ type, label }) => {
              const isChecked = selected.has(type);
              return (
                <View key={type} style={styles.docRow}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.checkbox,
                      { borderColor: palette.border },
                      isChecked && styles.checkboxChecked,
                      pressed && styles.checkboxPressed,
                    ]}
                    onPress={() => toggleDoc(type)}
                  >
                    {isChecked && <Text style={styles.checkmark}>✓</Text>}
                  </Pressable>
                  <View style={styles.docInfo}>
                    <Pressable onPress={() => toggleDoc(type)}>
                      <Text style={[styles.docLabel, isChecked && styles.docLabelActive]}>
                        {label}
                      </Text>
                    </Pressable>
                    {isChecked && (
                      <ThemedTextInput
                        style={styles.inputInline}
                        placeholder="Data expirare (AAAA-LL-ZZ)"
                        value={expiries[type] ?? ''}
                        onChangeText={v => setExpiry(type, v)}
                        editable={!loading}
                      />
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.saveButton,
              pressed && styles.saveButtonPressed,
              loading && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={loading}
          >
            <Text style={styles.saveButtonText}>
              {loading ? 'Se salvează...' : 'Salvează mașina'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 24, paddingBottom: 48 },
  stepBlock: {
    marginBottom: 28,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: primary,
  },
  hint: {
    fontSize: 13,
    opacity: 0.65,
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  docRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: primary,
    borderColor: primary,
  },
  checkboxPressed: { opacity: 0.7 },
  checkmark: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 18,
  },
  docInfo: { flex: 1 },
  docLabel: {
    fontSize: 16,
    paddingVertical: 2,
    opacity: 0.75,
  },
  docLabelActive: {
    opacity: 1,
    fontWeight: '500',
  },
  inputInline: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginTop: 8,
  },
  saveButton: {
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  saveButtonPressed: { opacity: 0.85 },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
