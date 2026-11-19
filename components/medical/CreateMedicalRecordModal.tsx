import { useState, useEffect, useCallback, useMemo } from 'react';
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
import { useEntities } from '@/hooks/useEntities';
import { MedicalConsentBody } from './MedicalConsentModal';
import type { Person } from '@/types';

interface Props {
  visible: boolean;
  onClose(): void;
  onCreated(id: string): void;
}

export function CreateMedicalRecordModal({ visible, onClose, onCreated }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const { persons, medicalRecords, createPerson, refresh } = useEntities();

  // Doar persoanele fără dosar: fiecare persoană poate avea un singur dosar
  // (UNIQUE pe person_id) — altfel userul afla abia la salvare („Dosar existent").
  const availablePersons = useMemo(() => {
    const taken = new Set(medicalRecords.map(r => r.person_id));
    return persons.filter(p => !taken.has(p.id));
  }, [persons, medicalRecords]);

  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  // Persoană nouă creată din formular (când nu există nicio persoană disponibilă
  // sau userul alege „Persoană nouă").
  const [creatingPerson, setCreatingPerson] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [dosarName, setDosarName] = useState('');
  const [aiToggle, setAiToggle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [consentCanAccept, setConsentCanAccept] = useState(false);
  const [showMedicalInfo, setShowMedicalInfo] = useState(false);
  const [bloodGroup, setBloodGroup] = useState('');
  const [allergies, setAllergies] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');

  useEffect(() => {
    if (!visible) return;
    setSelectedPerson(null);
    setNewPersonName('');
    setDosarName('');
    setAiToggle(false);
    setShowMedicalInfo(false);
    setBloodGroup('');
    setAllergies('');
    setEmergencyContactName('');
    setEmergencyContactPhone('');
    setShowConsent(false);
    setPendingId(null);
    setConsentCanAccept(false);
  }, [visible]);

  // Preselecție: o singură persoană disponibilă → aleasă automat; niciuna →
  // formularul trece direct pe „persoană nouă". Rulează la deschidere și când
  // lista se încarcă (useEntities e asincron).
  useEffect(() => {
    if (!visible) return;
    if (availablePersons.length === 0) {
      setCreatingPerson(true);
      setSelectedPerson(null);
    } else {
      setCreatingPerson(false);
      setSelectedPerson(prev =>
        prev && availablePersons.some(p => p.id === prev.id)
          ? prev
          : availablePersons.length === 1
            ? availablePersons[0]
            : null
      );
    }
  }, [visible, availablePersons]);

  const personOk = creatingPerson ? newPersonName.trim().length > 0 : selectedPerson !== null;
  const canSave = personOk && dosarName.trim().length > 0;

  const handleSave = useCallback(async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      let person: Person;
      if (creatingPerson) {
        person = await createPerson(newPersonName.trim());
      } else {
        if (!selectedPerson) return;
        person = selectedPerson;
        // Verificare UNIQUE constraint la nivel UX înainte de SQL
        const existing = await getMedicalRecordByPersonId(person.id);
        if (existing) {
          Alert.alert('Dosar existent', `Persoana «${person.name}» are deja un dosar medical.`);
          return;
        }
      }
      const rec = await createMedicalRecord({
        person_id: person.id,
        name: dosarName.trim(),
        blood_group: bloodGroup.trim() || undefined,
        allergies: allergies.trim() || undefined,
        emergency_contact_name: emergencyContactName.trim() || undefined,
        emergency_contact_phone: emergencyContactPhone.trim() || undefined,
      });
      if (aiToggle) {
        // Swap conținutul FormSheetModal de la formular la consent body — NU
        // deschidem al doilea <Modal> peste primul (iOS refuză două Modal-uri
        // siblings prezentate simultan).
        setPendingId(rec.id);
        setShowConsent(true);
      } else {
        // onCreated din parent face deja setMedicalModalVisible(false) + navigare
        // către dosar — onClose() suplimentar ar provoca router.back() care
        // ar suprascrie router.replace, lăsând user-ul pe ecran fără feedback.
        onCreated(rec.id);
      }
      if (creatingPerson) await refresh();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut crea dosarul medical.');
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    canSave,
    selectedPerson,
    creatingPerson,
    newPersonName,
    createPerson,
    refresh,
    dosarName,
    aiToggle,
    bloodGroup,
    allergies,
    emergencyContactName,
    emergencyContactPhone,
    onCreated,
  ]);

  const handleConsentAccept = useCallback(async () => {
    if (!pendingId) {
      setShowConsent(false);
      onClose();
      return;
    }
    setSaving(true);
    try {
      await setAiConsent(pendingId);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva consimțământul.');
      setSaving(false);
      return;
    }
    setSaving(false);
    setShowConsent(false);
    const id = pendingId;
    setPendingId(null);
    onCreated(id);
  }, [pendingId, onCreated, onClose]);

  const handleConsentReject = useCallback(() => {
    setShowConsent(false);
    const id = pendingId;
    setPendingId(null);
    if (id)
      onCreated(id); // dosar creat fără AI
    else onClose();
  }, [pendingId, onCreated, onClose]);

  return (
    <FormSheetModal
      visible={visible}
      title={showConsent ? 'Asistent AI pentru Dosarul medical' : 'Dosar medical nou'}
      onClose={showConsent ? handleConsentReject : onClose}
      onSave={showConsent ? handleConsentAccept : handleSave}
      saving={saving}
      saveDisabled={showConsent ? !consentCanAccept : !canSave}
      saveLabel={showConsent ? 'Activează' : 'Salvează'}
      cancelLabel={showConsent ? 'Refuz' : 'Anulează'}
    >
      {showConsent ? (
        <MedicalConsentBody
          onCanAcceptChange={setConsentCanAccept}
          resetKey={pendingId}
          scrollable={false}
        />
      ) : (
        <>
          {/* Secțiunea persoană */}
          <View>
            <Text style={[styles.label, { color: palette.text }]}>Persoană</Text>
            <Text style={[styles.hint, { color: palette.textSecondary }]}>
              {creatingPerson
                ? availablePersons.length === 0
                  ? persons.length === 0
                    ? 'Dosarul aparține unei persoane. Scrie numele ei — o adăugăm și în Entități → Persoane.'
                    : 'Toate persoanele au deja un dosar. Scrie numele persoanei noi — o adăugăm și în Entități → Persoane.'
                  : 'Scrie numele persoanei noi — o adăugăm și în Entități → Persoane.'
                : selectedPerson
                  ? 'Dosarul va aparține persoanei bifate.'
                  : 'Alege persoana căreia îi aparține dosarul.'}
            </Text>
            {creatingPerson ? (
              <>
                <TextInput
                  value={newPersonName}
                  onChangeText={setNewPersonName}
                  placeholder="ex. Maria Popescu"
                  placeholderTextColor={palette.textSecondary}
                  accessibilityLabel="Numele persoanei noi"
                  style={[
                    styles.input,
                    {
                      color: palette.text,
                      borderColor: palette.border,
                      backgroundColor: palette.surface,
                    },
                  ]}
                />
                {availablePersons.length > 0 ? (
                  <Pressable
                    onPress={() => setCreatingPerson(false)}
                    style={styles.linkBtn}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.linkText, { color: primary }]}>
                      Alege o persoană existentă
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <>
                <ScrollView
                  style={[styles.personList, { borderColor: palette.border }]}
                  nestedScrollEnabled
                >
                  {availablePersons.map(p => {
                    const selected = selectedPerson?.id === p.id;
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => setSelectedPerson(p)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={[
                          styles.personRow,
                          {
                            backgroundColor: selected ? `${primary}22` : palette.surface,
                            borderBottomColor: palette.border,
                          },
                        ]}
                      >
                        <View style={styles.personRowInner}>
                          <Ionicons
                            name={selected ? 'radio-button-on' : 'radio-button-off'}
                            size={20}
                            color={selected ? primary : palette.textSecondary}
                          />
                          <Text style={[styles.personName, { color: palette.text }]}>{p.name}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Pressable
                  onPress={() => {
                    setSelectedPerson(null);
                    setCreatingPerson(true);
                  }}
                  style={styles.linkBtn}
                  accessibilityRole="button"
                >
                  <Ionicons name="add" size={16} color={primary} />
                  <Text style={[styles.linkText, { color: primary }]}>Persoană nouă</Text>
                </Pressable>
              </>
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
                Extracție automată din documente + chat al dosarului. Îți cerem acordul explicit
                (GDPR Art. 9).
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
                  style={[
                    styles.input,
                    {
                      color: palette.text,
                      borderColor: palette.border,
                      backgroundColor: palette.surface,
                      minHeight: 60,
                    },
                  ]}
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
                  style={[
                    styles.input,
                    {
                      color: palette.text,
                      borderColor: palette.border,
                      backgroundColor: palette.surface,
                      marginBottom: 8,
                    },
                  ]}
                />
                <TextInput
                  value={emergencyContactPhone}
                  onChangeText={setEmergencyContactPhone}
                  placeholder="Telefon"
                  placeholderTextColor={palette.textSecondary}
                  keyboardType="phone-pad"
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
            </View>
          )}
        </>
      )}
    </FormSheetModal>
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
    gap: 8,
  },
  personName: { fontSize: 15 },
  hint: { fontSize: 12, lineHeight: 17, marginBottom: 8 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  linkText: { fontSize: 14, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  toggleHint: { fontSize: 12, lineHeight: 17 },
});
