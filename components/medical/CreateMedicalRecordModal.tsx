import { useState, useEffect, useCallback } from 'react';
import { View, TextInput, StyleSheet, Switch, Alert, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, onPrimary } from '@/theme/colors';
import {
  createMedicalRecord,
  getMedicalRecordByPersonId,
  setAiConsent,
} from '@/services/medicalRecord';
import { ensureMedicalMasterKey } from '@/services/medicalCrypto';
import { useEntities } from '@/hooks/useEntities';
import { MedicalConsentModal } from './MedicalConsentModal';
import type { Person } from '@/types';

interface Props {
  visible: boolean;
  onClose(): void;
  onCreated(id: string): void;
}

export function CreateMedicalRecordModal({ visible, onClose, onCreated }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const { persons } = useEntities();

  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [dosarName, setDosarName] = useState('');
  const [aiToggle, setAiToggle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [showMedicalInfo, setShowMedicalInfo] = useState(false);
  const [bloodGroup, setBloodGroup] = useState('');
  const [allergies, setAllergies] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');

  useEffect(() => {
    if (!visible) return;
    setSelectedPerson(null);
    setDosarName('');
    setAiToggle(false);
    setShowMedicalInfo(false);
    setBloodGroup('');
    setAllergies('');
    setEmergencyContactName('');
    setEmergencyContactPhone('');
  }, [visible]);

  const canSave = selectedPerson !== null && dosarName.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (saving || !canSave || !selectedPerson) return;
    setSaving(true);
    try {
      // Verificare UNIQUE constraint la nivel UX înainte de SQL
      const existing = await getMedicalRecordByPersonId(selectedPerson.id);
      if (existing) {
        Alert.alert(
          'Dosar existent',
          `Persoana «${selectedPerson.name}» are deja un dosar medical.`
        );
        return;
      }
      await ensureMedicalMasterKey();
      const rec = await createMedicalRecord({
        person_id: selectedPerson.id,
        name: dosarName.trim(),
        blood_group: bloodGroup.trim() || undefined,
        allergies: allergies.trim() || undefined,
        emergency_contact_name: emergencyContactName.trim() || undefined,
        emergency_contact_phone: emergencyContactPhone.trim() || undefined,
      });
      if (aiToggle) {
        setPendingId(rec.id);
        setShowConsent(true);
      } else {
        onClose();
        onCreated(rec.id);
      }
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut crea dosarul medical.');
    } finally {
      setSaving(false);
    }
  }, [saving, canSave, selectedPerson, dosarName, aiToggle, onCreated, onClose]);

  const handleConsentAccept = useCallback(async () => {
    if (!pendingId) return;
    try {
      await setAiConsent(pendingId);
      onCreated(pendingId);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva consimțământul.');
    }
    setShowConsent(false);
    setPendingId(null);
    onClose();
  }, [pendingId, onCreated, onClose]);

  const handleConsentReject = useCallback(() => {
    if (pendingId) onCreated(pendingId); // dosar creat fără AI
    setShowConsent(false);
    setPendingId(null);
    onClose();
  }, [pendingId, onCreated, onClose]);

  return (
    <>
      <FormSheetModal
        visible={visible}
        title="Dosar medical nou"
        onClose={onClose}
        onSave={handleSave}
        saving={saving}
        saveDisabled={!canSave}
      >
        {/* Secțiunea persoană */}
        <View>
          <Text style={[styles.label, { color: palette.text }]}>Persoană</Text>
          {persons.length === 0 ? (
            <View style={[styles.emptyBox, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
                Adaugă mai întâi o persoană în Entități → Persoane
              </Text>
            </View>
          ) : (
            <ScrollView
              style={[styles.personList, { borderColor: palette.border }]}
              nestedScrollEnabled
            >
              {persons.map(p => {
                const selected = selectedPerson?.id === p.id;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setSelectedPerson(p)}
                    style={[
                      styles.personRow,
                      {
                        backgroundColor: selected ? `${primary}22` : palette.surface,
                        borderBottomColor: palette.border,
                      },
                    ]}
                  >
                    <View style={styles.personRowInner}>
                      <Text style={[styles.personName, { color: palette.text }]}>{p.name}</Text>
                      {selected && (
                        <Text style={[styles.checkmark, { color: primary }]}>✓</Text>
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Secțiunea nume dosar */}
        <View style={{ marginTop: 12 }}>
          <Text style={[styles.label, { color: palette.text }]}>Nume dosar</Text>
          <TextInput
            value={dosarName}
            onChangeText={setDosarName}
            placeholder="Ex: Dosar Maria, Analize 2024"
            placeholderTextColor={palette.textSecondary}
            style={[
              styles.input,
              {
                color: palette.text,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              },
            ]}
          />
        </View>

        {/* Toggle AI */}
        <View style={styles.toggleRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={[styles.label, { color: palette.text, marginTop: 0 }]}>
              Activează asistent AI
            </Text>
            <Text style={[styles.toggleHint, { color: palette.textSecondary }]}>
              Extracție automată din documente + chat specializat. Necesită consimțământ GDPR.
            </Text>
          </View>
          <Switch
            value={aiToggle}
            onValueChange={setAiToggle}
            trackColor={{ true: primary, false: palette.border }}
            thumbColor={onPrimary}
          />
        </View>

        {/* Secțiune colapsibilă: informații medicale */}
        <Pressable
          onPress={() => setShowMedicalInfo(v => !v)}
          style={[styles.collapsibleHeader, { borderTopColor: palette.border }]}
        >
          <Text style={[styles.collapsibleTitle, { color: palette.text }]}>
            Informații medicale (opțional)
          </Text>
          <Ionicons
            name={showMedicalInfo ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={palette.textSecondary}
          />
        </Pressable>
        {showMedicalInfo && (
          <View style={{ gap: 12, paddingBottom: 12 }}>
            {/* Grupa sanguină */}
            <View>
              <Text style={[styles.label, { color: palette.textSecondary, marginTop: 0 }]}>
                Grupa sanguină
              </Text>
              <TextInput
                value={bloodGroup}
                onChangeText={setBloodGroup}
                placeholder="ex. A pozitiv, 0 negativ"
                placeholderTextColor={palette.textSecondary}
                style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
              />
            </View>
            {/* Alergii */}
            <View>
              <Text style={[styles.label, { color: palette.textSecondary, marginTop: 0 }]}>
                Alergii cunoscute
              </Text>
              <TextInput
                value={allergies}
                onChangeText={setAllergies}
                placeholder="ex. penicilină, fragi, polen"
                placeholderTextColor={palette.textSecondary}
                multiline
                numberOfLines={2}
                style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface, minHeight: 60 }]}
              />
            </View>
            {/* Contact urgență */}
            <View>
              <Text style={[styles.label, { color: palette.textSecondary, marginTop: 0 }]}>
                Contact urgență (opțional)
              </Text>
              <TextInput
                value={emergencyContactName}
                onChangeText={setEmergencyContactName}
                placeholder="Nume"
                placeholderTextColor={palette.textSecondary}
                style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface, marginBottom: 8 }]}
              />
              <TextInput
                value={emergencyContactPhone}
                onChangeText={setEmergencyContactPhone}
                placeholder="Telefon"
                placeholderTextColor={palette.textSecondary}
                keyboardType="phone-pad"
                style={[styles.input, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
              />
            </View>
          </View>
        )}
      </FormSheetModal>

      <MedicalConsentModal
        visible={showConsent}
        onAccept={handleConsentAccept}
        onReject={handleConsentReject}
      />
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', marginTop: 4, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  collapsibleTitle: { fontSize: 16, fontWeight: '600' },
  emptyBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    borderStyle: 'dashed',
  },
  emptyText: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  personList: {
    borderWidth: 1,
    borderRadius: 10,
    maxHeight: 220,
  },
  personRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  personRowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  personName: { fontSize: 15 },
  checkmark: { fontSize: 18, fontWeight: '700' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  toggleHint: { fontSize: 12, lineHeight: 17 },
});
