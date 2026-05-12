import { useState, useEffect, useCallback } from 'react';
import { View, TextInput, Pressable, StyleSheet, Switch, Alert } from 'react-native';
import { Text } from '@/components/Themed';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, onPrimary } from '@/theme/colors';
import { db } from '@/services/db';
import { createMedicalRecord, setAiConsent } from '@/services/medicalRecord';
import { ensureMedicalMasterKey } from '@/services/medicalCrypto';
import { MedicalConsentModal } from './MedicalConsentModal';
import type { Person } from '@/types';

interface Props {
  visible: boolean;
  onClose(): void;
  onCreated(id: string): void;
}

interface PersonRow {
  id: string;
  name: string;
  created_at: string;
}

export function CreateMedicalRecordModal({ visible, onClose, onCreated }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [persons, setPersons] = useState<Person[]>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [aiToggle, setAiToggle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const loadEligiblePersons = useCallback(async () => {
    const rows = await db.getAllAsync<PersonRow>(`
      SELECT p.id, p.name, p.created_at
      FROM persons p
      LEFT JOIN medical_record m ON m.person_id = p.id
      WHERE m.id IS NULL
      ORDER BY p.name COLLATE NOCASE
    `);
    setPersons(rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at })));
  }, []);

  useEffect(() => {
    if (!visible) return;
    loadEligiblePersons();
    setSelectedPersonId(null);
    setName('');
    setAiToggle(false);
  }, [visible, loadEligiblePersons]);

  useEffect(() => {
    const p = persons.find(pp => pp.id === selectedPersonId);
    if (p) setName(`Dosar medical ${p.name}`);
  }, [selectedPersonId, persons]);

  const handleSave = useCallback(async () => {
    if (!selectedPersonId || !name.trim()) return;
    setSaving(true);
    try {
      await ensureMedicalMasterKey();
      const rec = await createMedicalRecord({
        person_id: selectedPersonId,
        name: name.trim(),
      });
      if (aiToggle) {
        setPendingId(rec.id);
        setShowConsent(true);
      } else {
        onCreated(rec.id);
        onClose();
      }
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut crea dosarul medical.');
    } finally {
      setSaving(false);
    }
  }, [selectedPersonId, name, aiToggle, onCreated, onClose]);

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
        saveDisabled={!selectedPersonId || !name.trim()}
      >
        <View>
          <Text style={[styles.label, { color: palette.text }]}>Pentru cine</Text>
          {persons.length === 0 ? (
            <Text style={[styles.emptyHint, { color: palette.textSecondary }]}>
              Toate persoanele au deja dosar medical. Adaugă o persoană nouă din Entități pentru a
              putea crea un dosar.
            </Text>
          ) : (
            <View style={styles.personList}>
              {persons.map(p => {
                const sel = p.id === selectedPersonId;
                return (
                  <Pressable
                    key={p.id}
                    style={[
                      styles.personRow,
                      {
                        backgroundColor: sel ? primary : palette.surface,
                        borderColor: sel ? primary : palette.border,
                      },
                    ]}
                    onPress={() => setSelectedPersonId(p.id)}
                  >
                    <Text
                      style={{
                        color: sel ? onPrimary : palette.text,
                        fontWeight: sel ? '600' : '400',
                      }}
                    >
                      {p.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        <View>
          <Text style={[styles.label, { color: palette.text }]}>Nume dosar</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Dosar medical"
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
  personList: { gap: 8 },
  personRow: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  emptyHint: { fontSize: 13, padding: 12, lineHeight: 19 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  toggleHint: { fontSize: 12, lineHeight: 17 },
});
