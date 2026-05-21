import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  TextInput,
  Linking,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, statusColors } from '@/theme/colors';
import { BottomActionBar } from '@/components/BottomActionBar';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import AppLockScreen from '@/components/AppLockScreen';
import { useMedicalLock } from '@/hooks/useMedicalLock';
import { useMedicalRecord } from '@/hooks/useMedicalRecord';
import { useEntities } from '@/hooks/useEntities';
import { deleteMedicalRecord, updateMedicalRecord } from '@/services/medicalRecord';
import { getDocuments, addEntityLinkToDocument } from '@/services/documents';
import { db } from '@/services/db';
import { MEDICAL_DOC_TYPES, DOCUMENT_TYPE_LABELS } from '@/types';
import type { Document, DocumentType } from '@/types';
import { TimelineTab } from '../_tabs/TimelineTab';
import { DocumenteTab } from '../_tabs/DocumenteTab';
import { ChatTab } from '../_tabs/ChatTab';

type TabKey = 'timeline' | 'documente' | 'chat';

const TAB_LABELS: Record<TabKey, string> = {
  timeline: 'Timeline',
  documente: 'Documente',
  chat: 'Chat',
};

export default function MedicalRecordDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const lock = useMedicalLock();
  const { record, stats, loading, error, refresh } = useMedicalRecord(id ?? null);
  const { persons } = useEntities();
  const [tab, setTab] = useState<TabKey>('timeline');
  const [linkDocVisible, setLinkDocVisible] = useState(false);
  const [unlinkedMedDocs, setUnlinkedMedDocs] = useState<Document[]>([]);

  // Edit dosar
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editBloodGroup, setEditBloodGroup] = useState('');
  const [editAllergies, setEditAllergies] = useState('');
  const [editEmergencyName, setEditEmergencyName] = useState('');
  const [editEmergencyPhone, setEditEmergencyPhone] = useState('');

  // Persoana legată de dosar
  const linkedPerson = record?.person_id
    ? persons.find(p => p.id === record.person_id)
    : undefined;

  // ── Asociere documente medicale existente care nu sunt încă „atașate" la
  //    dosar prin entity_links. Acoperă scenariul: ai documente medicale
  //    uploadate fără atașare.
  const loadUnlinked = useCallback(async () => {
    if (!record) return;
    const all = await getDocuments();
    const linkedRows = await db.getAllAsync<{ document_id: string }>(
      'SELECT document_id FROM document_entities WHERE entity_type = ? AND entity_id = ?',
      ['medical_record', record.id]
    );
    const linkedSet = new Set(linkedRows.map(r => r.document_id));
    const candidates = all
      .filter(d => (MEDICAL_DOC_TYPES as ReadonlySet<string>).has(d.type) && !linkedSet.has(d.id))
      .sort((a, b) => (b.issue_date ?? '').localeCompare(a.issue_date ?? ''));
    setUnlinkedMedDocs(candidates);
  }, [record]);

  useEffect(() => {
    if (linkDocVisible) loadUnlinked();
  }, [linkDocVisible, loadUnlinked]);

  const openLinkDoc = useCallback(async () => {
    setLinkDocVisible(true);
  }, []);

  const handleLinkDoc = useCallback(
    async (docId: string) => {
      if (!record) return;
      try {
        await addEntityLinkToDocument(docId, {
          entityType: 'medical_record',
          entityId: record.id,
        });
        setUnlinkedMedDocs(prev => prev.filter(d => d.id !== docId));
      } catch (e) {
        Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut asocia documentul.');
      }
    },
    [record]
  );

  const openEdit = useCallback(() => {
    if (!record) return;
    setEditName(record.name);
    setEditBloodGroup(record.blood_group ?? '');
    setEditAllergies(record.allergies ?? '');
    setEditEmergencyName(record.emergency_contact_name ?? '');
    setEditEmergencyPhone(record.emergency_contact_phone ?? '');
    setEditVisible(true);
  }, [record]);

  const handleSaveEdit = useCallback(async () => {
    if (!record) return;
    if (!editName.trim()) {
      Alert.alert('Eroare', 'Introdu un nume.');
      return;
    }
    setEditSaving(true);
    try {
      await updateMedicalRecord(record.id, {
        name: editName.trim(),
        blood_group: editBloodGroup.trim() || null,
        allergies: editAllergies.trim() || null,
        emergency_contact_name: editEmergencyName.trim() || null,
        emergency_contact_phone: editEmergencyPhone.trim() || null,
      });
      await refresh();
      setEditVisible(false);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva');
    } finally {
      setEditSaving(false);
    }
  }, [record, editName, editBloodGroup, editAllergies, editEmergencyName, editEmergencyPhone, refresh]);

  const handleDelete = useCallback(() => {
    if (!record) return;
    const obs = stats?.observations_total ?? 0;
    const docs = stats?.documents_total ?? 0;
    const threads = stats?.threads_total ?? 0;
    const lines = [
      `Vei șterge dosarul „${record.name}" definitiv.`,
      '',
      'Acum conține:',
      `• ${obs} observații (analize/valori extrase)`,
      `• ${threads} conversații cu asistentul AI`,
      `• ${docs} documente medicale (rămân în aplicație, NU se șterg)`,
      '',
      'Continui?',
    ].join('\n');
    Alert.alert('Șterge dosar medical', lines, [
      { text: 'Anulează', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMedicalRecord(record.id);
            router.back();
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge dosarul.');
          }
        },
      },
    ]);
  }, [record, stats, router]);

  // App Lock guard: afișat dacă lockEnabled e activ și ecranul e blocat
  if (lock.lockEnabled && lock.locked) {
    return (
      <AppLockScreen
        biometricAvailable={lock.biometricAvailable}
        onUnlockBiometric={lock.unlockWithBiometric}
        onUnlockPin={lock.unlockWithPin}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <Stack.Screen
        options={{
          title: record?.name ?? 'Dosar medical',
          headerBackTitle: 'Înapoi',
          headerRight: () =>
            record ? (
              <Pressable onPress={openEdit} hitSlop={12} style={{ paddingLeft: 8 }}>
                <Ionicons name="create-outline" size={24} color={primary} />
              </Pressable>
            ) : null,
        }}
      />

      <View
        style={[
          styles.tabBar,
          { borderBottomColor: palette.border, backgroundColor: palette.surface },
        ]}
      >
        {(Object.keys(TAB_LABELS) as TabKey[]).map(t => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              style={[styles.tab, active && { borderBottomColor: primary, borderBottomWidth: 2 }]}
              onPress={() => setTab(t)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={{
                  color: active ? primary : palette.textSecondary,
                  fontWeight: active ? '700' : '500',
                }}
              >
                {TAB_LABELS[t]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading && !record ? (
        <View style={styles.center}>
          <ActivityIndicator color={primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={{ color: palette.textSecondary }}>{error}</Text>
        </View>
      ) : !record ? (
        <View style={styles.center}>
          <Text style={{ color: palette.textSecondary }}>Dosar negăsit.</Text>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* ── Patient info header ── */}
          {(linkedPerson || record.blood_group || record.allergies || record.emergency_contact_name || record.emergency_contact_phone) ? (
            <View style={[styles.patientHeader, { backgroundColor: palette.surface, borderBottomColor: palette.border }]}>
              {linkedPerson ? (
                <Pressable
                  style={styles.patientPersonRow}
                  onPress={() => router.push(`/(tabs)/entitati/${linkedPerson.id}`)}
                  accessibilityLabel={`Navighează la persoana ${linkedPerson.name}`}
                >
                  <Ionicons name="person-outline" size={15} color={palette.textSecondary} />
                  <Text style={[styles.patientPersonName, { color: palette.text }]}>
                    {linkedPerson.name}
                    {(() => {
                      if (!linkedPerson.date_of_birth) return null;
                      try {
                        const ageYears = Math.floor(
                          (Date.now() - new Date(linkedPerson.date_of_birth).getTime()) /
                          (365.25 * 24 * 3600 * 1000)
                        );
                        if (isNaN(ageYears) || ageYears < 0) return null;
                        return ` · ${ageYears} ani`;
                      } catch {
                        return null;
                      }
                    })()}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={palette.textSecondary} />
                </Pressable>
              ) : null}
              {record.blood_group ? (
                <View style={styles.patientInfoRow}>
                  <Text style={[styles.patientInfoLabel, { color: palette.textSecondary }]}>Grupa sanguină</Text>
                  <View style={[styles.bloodGroupBadge, { backgroundColor: `${primary}22`, borderColor: `${primary}66` }]}>
                    <Text style={[styles.bloodGroupText, { color: primary }]}>{record.blood_group}</Text>
                  </View>
                </View>
              ) : null}
              {record.allergies ? (
                <View style={[styles.allergiesCard, { backgroundColor: statusColors.warningSurface, borderLeftColor: statusColors.warning }]}>
                  <Ionicons name="warning-outline" size={16} color={statusColors.warning} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={[styles.allergiesLabel, { color: statusColors.warning }]}>Alergii</Text>
                    <Text style={[styles.allergiesText, { color: palette.text }]}>{record.allergies}</Text>
                  </View>
                </View>
              ) : null}
              {(record.emergency_contact_name || record.emergency_contact_phone) ? (
                <View style={styles.patientInfoRow}>
                  <Ionicons name="call-outline" size={15} color={palette.textSecondary} />
                  <View style={{ marginLeft: 6, flex: 1 }}>
                    <Text style={[styles.patientInfoLabel, { color: palette.textSecondary }]}>Contact urgență</Text>
                    {record.emergency_contact_name ? (
                      <Text style={[styles.emergencyName, { color: palette.text }]}>{record.emergency_contact_name}</Text>
                    ) : null}
                    {record.emergency_contact_phone ? (
                      <Pressable onPress={() => Linking.openURL(`tel:${record.emergency_contact_phone}`)}>
                        <Text style={[styles.emergencyPhone, { color: primary }]}>{record.emergency_contact_phone}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {tab === 'timeline' && (
            <TimelineTab recordId={record.id} stats={stats} onChange={refresh} />
          )}
          {tab === 'documente' && <DocumenteTab record={record} />}
          {tab === 'chat' && <ChatTab record={record} />}
        </View>
      )}

      {/* ── Bottom actions ── */}
      {record ? (
        <BottomActionBar
          actions={[
            {
              icon: 'add-circle-outline',
              label: 'Adaugă doc',
              onPress: () =>
                router.push({
                  pathname: '/(tabs)/documente/add',
                  params: { medical_record_id: record.id, restrict_to: 'medical' },
                }),
            },
            {
              icon: 'link-outline',
              label: 'Asociază',
              onPress: openLinkDoc,
            },
            {
              icon: 'trash-outline',
              label: 'Șterge',
              onPress: handleDelete,
              danger: true,
            },
          ]}
        />
      ) : null}

      {/* ── Link existing document modal ── */}
      <Modal
        visible={linkDocVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setLinkDocVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: palette.card }]}>
            <Text style={[styles.modalTitle, { color: palette.text }]}>
              Asociează document medical
            </Text>
            {unlinkedMedDocs.length === 0 ? (
              <Text style={[styles.modalEmpty, { color: palette.textSecondary }]}>
                Nu există documente medicale neasociate. Adaugă unul nou cu „Adaugă doc".
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {unlinkedMedDocs.map(d => (
                  <Pressable
                    key={d.id}
                    style={[styles.linkDocRow, { borderBottomColor: palette.border }]}
                    onPress={() => handleLinkDoc(d.id)}
                  >
                    <Text style={[styles.linkDocType, { color: primary }]}>
                      {DOCUMENT_TYPE_LABELS[d.type as DocumentType] ?? d.type}
                    </Text>
                    {d.issue_date ? (
                      <Text
                        style={[styles.linkDocSub, { color: palette.textSecondary }]}
                        numberOfLines={1}
                      >
                        Data: {d.issue_date}
                      </Text>
                    ) : null}
                    {d.note ? (
                      <Text
                        style={[styles.linkDocSub, { color: palette.textSecondary }]}
                        numberOfLines={1}
                      >
                        {d.note}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable
              style={[styles.modalCloseBtn, { backgroundColor: primary }]}
              onPress={() => setLinkDocVisible(false)}
            >
              <Text style={styles.modalCloseText}>Închide</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* ── Edit dosar ── */}
      <FormSheetModal
        visible={editVisible}
        title="Editează dosar medical"
        onClose={() => setEditVisible(false)}
        onSave={handleSaveEdit}
        saving={editSaving}
        saveDisabled={!editName.trim()}
      >
        <View>
          <Text style={[styles.formLabel, { color: palette.text }]}>Nume dosar</Text>
          <TextInput
            value={editName}
            onChangeText={setEditName}
            placeholder="Nume dosar"
            placeholderTextColor={palette.textSecondary}
            style={[
              styles.formInput,
              {
                color: palette.text,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              },
            ]}
            editable={!editSaving}
            autoFocus
          />
        </View>
        {/* Persoana legată — read-only (se editează din detaliu persoană) */}
        {linkedPerson ? (
          <View>
            <Text style={[styles.formLabel, { color: palette.text }]}>Persoană</Text>
            <Pressable
              style={[
                styles.personRow,
                {
                  borderColor: palette.border,
                  backgroundColor: palette.surface,
                },
              ]}
              onPress={() => {
                setEditVisible(false);
                router.push(`/(tabs)/entitati/${linkedPerson.id}`);
              }}
            >
              <Text style={[styles.personName, { color: palette.text }]}>{linkedPerson.name}</Text>
              <Ionicons name="chevron-forward" size={18} color={palette.textSecondary} />
            </Pressable>
          </View>
        ) : null}
        <View>
          <Text style={[styles.formLabel, { color: palette.text }]}>Grupa sanguină (opțional)</Text>
          <TextInput
            value={editBloodGroup}
            onChangeText={setEditBloodGroup}
            placeholder="ex. A pozitiv, 0 negativ"
            placeholderTextColor={palette.textSecondary}
            style={[styles.formInput, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            editable={!editSaving}
          />
        </View>
        <View>
          <Text style={[styles.formLabel, { color: palette.text }]}>Alergii cunoscute (opțional)</Text>
          <TextInput
            value={editAllergies}
            onChangeText={setEditAllergies}
            placeholder="ex. penicilină, fragi, polen"
            placeholderTextColor={palette.textSecondary}
            multiline
            numberOfLines={2}
            style={[styles.formInput, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface, minHeight: 60 }]}
            editable={!editSaving}
          />
        </View>
        <View>
          <Text style={[styles.formLabel, { color: palette.text }]}>Contact urgență — Nume (opțional)</Text>
          <TextInput
            value={editEmergencyName}
            onChangeText={setEditEmergencyName}
            placeholder="Nume"
            placeholderTextColor={palette.textSecondary}
            style={[styles.formInput, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            editable={!editSaving}
          />
        </View>
        <View>
          <Text style={[styles.formLabel, { color: palette.text }]}>Contact urgență — Telefon (opțional)</Text>
          <TextInput
            value={editEmergencyPhone}
            onChangeText={setEditEmergencyPhone}
            placeholder="Telefon"
            placeholderTextColor={palette.textSecondary}
            keyboardType="phone-pad"
            style={[styles.formInput, { color: palette.text, borderColor: palette.border, backgroundColor: palette.surface }]}
            editable={!editSaving}
          />
        </View>
      </FormSheetModal>
    </View>
  );
}

// ── Person row (outside edit modal — visible in detail screen header area)
// Note: the linked person row is only shown inside the edit form for navigation convenience.

export function LinkedPersonRow({
  personId,
  personName,
  palette,
}: {
  personId: string;
  personName: string;
  palette: typeof light;
}) {
  const router = useRouter();
  return (
    <Pressable
      style={[
        styles.linkedPersonRow,
        { borderColor: palette.border, backgroundColor: palette.surface },
      ]}
      onPress={() => router.push(`/(tabs)/entitati/${personId}`)}
      accessibilityLabel={`Navighează la persoana ${personName}`}
    >
      <Ionicons name="person-outline" size={16} color={palette.textSecondary} />
      <Text style={[styles.linkedPersonLabel, { color: palette.textSecondary }]}>Persoană</Text>
      <Text style={[styles.linkedPersonName, { color: palette.text }]} numberOfLines={1}>
        {personName}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabBar: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: { borderRadius: 16, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  modalEmpty: { fontSize: 14, lineHeight: 20, marginVertical: 12 },
  linkDocRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkDocType: { fontSize: 15, fontWeight: '600' },
  linkDocSub: { fontSize: 12, marginTop: 2 },
  modalCloseBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalCloseText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  // Form
  formLabel: { fontSize: 14, fontWeight: '600', marginTop: 4, marginBottom: 6 },
  formInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
  // Person row in edit form
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  personName: { fontSize: 16, flex: 1 },
  // Linked person row (standalone)
  linkedPersonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkedPersonLabel: { fontSize: 13 },
  linkedPersonName: { flex: 1, fontSize: 15 },
  // Patient info header
  patientHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  patientPersonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  patientPersonName: { fontSize: 15, fontWeight: '500', flex: 1 },
  patientInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  patientInfoLabel: { fontSize: 13 },
  bloodGroupBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  bloodGroupText: { fontSize: 14, fontWeight: '700' },
  allergiesCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderLeftWidth: 3,
    borderRadius: 6,
    padding: 10,
  },
  allergiesLabel: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  allergiesText: { fontSize: 14, lineHeight: 20 },
  emergencyName: { fontSize: 14, fontWeight: '500' },
  emergencyPhone: { fontSize: 14 },
});
