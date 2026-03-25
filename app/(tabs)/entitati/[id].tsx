import { useEffect, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  View as RNView,
  Text as RNText,
} from 'react-native';
import { router, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedTextInput } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useEntities } from '@/hooks/useEntities';
import { useDocuments } from '@/hooks/useDocuments';
import { getDocuments, linkDocumentToEntity } from '@/services/documents';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { Document as DocType, Company } from '@/types';

export default function EntityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();

  const {
    persons, properties, vehicles, cards, animals, companies,
    refresh: refreshEntities,
    deletePerson, deleteProperty, deleteVehicle, deleteCard, deleteAnimal, deleteCompany,
    updatePerson, updateProperty, updateVehicle, updateCard, updateAnimal, updateCompany,
  } = useEntities();
  const { getDocumentsByEntity } = useDocuments();

  const [documents, setDocuments] = useState<DocType[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityName, setEntityName] = useState('');
  const [entityKind, setEntityKind] = useState<'person_id' | 'property_id' | 'vehicle_id' | 'card_id' | 'animal_id' | 'company_id'>('person_id');

  const [editVisible, setEditVisible] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editLast4, setEditLast4] = useState('');
  const [editExpiry, setEditExpiry] = useState('');
  const [editSpecies, setEditSpecies] = useState('');
  const [editCui, setEditCui] = useState('');
  const [editRegCom, setEditRegCom] = useState('');
  const [linkDocVisible, setLinkDocVisible] = useState(false);
  const [unlinkedDocs, setUnlinkedDocs] = useState<DocType[]>([]);

  useEffect(() => {
    if (!id) return;
    const person = persons.find(p => p.id === id);
    const property = properties.find(p => p.id === id);
    const vehicle = vehicles.find(v => v.id === id);
    const card = cards.find(c => c.id === id);
    const animal = animals.find(a => a.id === id);
    const company = companies.find(c => c.id === id);
    if (person) { setEntityName(person.name); setEntityKind('person_id'); }
    else if (property) { setEntityName(property.name); setEntityKind('property_id'); }
    else if (vehicle) { setEntityName(vehicle.name); setEntityKind('vehicle_id'); }
    else if (card) { setEntityName(card.nickname || 'Card'); setEntityKind('card_id'); }
    else if (animal) { setEntityName(animal.name); setEntityKind('animal_id'); }
    else if (company) { setEntityName(company.name); setEntityKind('company_id'); }
  }, [id, persons, properties, vehicles, cards, animals, companies]);

  async function loadDocs(kind: typeof entityKind, entityId: string) {
    if (!entityId) return;
    setLoading(true);
    try {
      const list = await getDocumentsByEntity(kind, entityId);
      setDocuments(list);
    } catch {
      setDocuments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!id || !entityName) return;
    loadDocs(entityKind, id);
  }, [id, entityKind, entityName]);

  useFocusEffect(useCallback(() => { refreshEntities(); }, []));

  const refresh = () => {
    refreshEntities();
    if (id && entityName) loadDocs(entityKind, id);
  };

  async function openLinkDoc() {
    const all = await getDocuments();
    setUnlinkedDocs(all.filter(d =>
      !d.person_id && !d.property_id && !d.vehicle_id &&
      !d.card_id && !d.animal_id && !d.company_id
    ));
    setLinkDocVisible(true);
  }

  async function handleLinkDoc(docId: string) {
    await linkDocumentToEntity(docId, { [entityKind]: id as string });
    setLinkDocVisible(false);
    loadDocs(entityKind, id as string);
  }

  const handleDelete = () => {
    Alert.alert('Ștergere', `Ștergi „${entityName}"? Documentele legate nu vor fi șterse.`, [
      { text: 'Anulare', style: 'cancel' },
      {
        text: 'Șterge', style: 'destructive',
        onPress: async () => {
          try {
            if (entityKind === 'person_id') await deletePerson(id!);
            else if (entityKind === 'property_id') await deleteProperty(id!);
            else if (entityKind === 'vehicle_id') await deleteVehicle(id!);
            else if (entityKind === 'animal_id') await deleteAnimal(id!);
            else if (entityKind === 'company_id') await deleteCompany(id!);
            else await deleteCard(id!);
            router.back();
          } catch (e) {
            Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut șterge');
          }
        },
      },
    ]);
  };

  const openEditModal = () => {
    if (entityKind === 'card_id') {
      const card = cards.find(c => c.id === id);
      setEditNickname(card?.nickname ?? '');
      setEditLast4(card?.last4 ?? '');
      setEditExpiry(card?.expiry ?? '');
    } else if (entityKind === 'animal_id') {
      const animal = animals.find(a => a.id === id);
      setEditName(animal?.name ?? '');
      setEditSpecies(animal?.species ?? '');
    } else if (entityKind === 'company_id') {
      const company = companies.find(c => c.id === id);
      setEditName(company?.name ?? '');
      setEditCui(company?.cui ?? '');
      setEditRegCom(company?.reg_com ?? '');
    } else {
      setEditName(entityName);
    }
    setEditVisible(true);
  };

  const handleSaveEdit = async () => {
    if (entityKind === 'card_id') {
      if (!editNickname.trim()) { Alert.alert('Eroare', 'Introdu un nickname.'); return; }
    } else {
      if (!editName.trim()) { Alert.alert('Eroare', 'Introdu un nume.'); return; }
    }
    setEditLoading(true);
    try {
      if (entityKind === 'person_id') await updatePerson(id!, editName.trim());
      else if (entityKind === 'property_id') await updateProperty(id!, editName.trim());
      else if (entityKind === 'vehicle_id') await updateVehicle(id!, editName.trim());
      else if (entityKind === 'animal_id') await updateAnimal(id!, editName.trim(), editSpecies.trim() || 'câine');
      else if (entityKind === 'company_id') await updateCompany(id!, editName.trim(), editCui.trim() || undefined, editRegCom.trim() || undefined);
      else await updateCard(id!, editNickname.trim(), editLast4.trim() || '****', editExpiry.trim() || undefined);
      await refreshEntities();
      setEditVisible(false);
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut salva');
    } finally {
      setEditLoading(false);
    }
  };

  const isVehicle = entityKind === 'vehicle_id';
  const isCard = entityKind === 'card_id';
  const isAnimal = entityKind === 'animal_id';
  const isCompany = entityKind === 'company_id';

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>

      {/* ── Header ── */}
      <RNView style={[styles.header, { backgroundColor: C.background, paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={C.primary} />
        </Pressable>
        <RNText style={[styles.headerTitle, { color: C.text }]} numberOfLines={1}>
          {entityName || '...'}
        </RNText>
        <Pressable
          style={[styles.editBtn, { borderColor: C.primary }]}
          onPress={openEditModal}
        >
          <RNText style={[styles.editBtnText, { color: C.primary }]}>Editează</RNText>
        </Pressable>
      </RNView>

      {/* ── Document list ── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>DOCUMENTE LEGATE</RNText>

        {documents.length === 0 && !loading && (
          <RNText style={[styles.empty, { color: C.textSecondary }]}>
            Niciun document. Adaugă unul mai jos.
          </RNText>
        )}

        {documents.map(doc => (
          <Pressable
            key={doc.id}
            style={({ pressed }) => [
              styles.docRow,
              { backgroundColor: C.card, shadowColor: C.cardShadow },
              pressed && styles.docRowPressed,
            ]}
            onPress={() => router.push({ pathname: '/(tabs)/documente/[id]', params: { id: doc.id } })}
          >
            <RNView style={styles.docRowText}>
              <RNText style={[styles.docType, { color: C.text }]}>
                {DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type}
              </RNText>
              {doc.issue_date && (
                <RNText style={[styles.docMeta, { color: C.textSecondary }]}>Emis: {doc.issue_date}</RNText>
              )}
              {doc.expiry_date && (
                <RNText style={[styles.docMeta, { color: C.textSecondary }]}>Expiră: {doc.expiry_date}</RNText>
              )}
            </RNView>
            <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
          </Pressable>
        ))}
      </ScrollView>

      {/* ── Bottom actions ── */}
      <RNView style={[styles.bottomBar, { borderTopColor: C.border, backgroundColor: C.background, paddingBottom: insets.bottom + 12 }]}>

        {/* Vehicle-specific actions */}
        {isVehicle && (
          <RNView style={styles.vehicleActions}>
            <Pressable
              style={({ pressed }) => [styles.actionBtn, { borderColor: C.primary }, pressed && styles.btnPressed]}
              onPress={() => router.push(`/(tabs)/entitati/fuel?vehicleId=${id}&vehicleName=${encodeURIComponent(entityName)}`)}
            >
              <Ionicons name="flame-outline" size={16} color={C.primary} style={styles.actionIcon} />
              <RNText style={[styles.actionBtnText, { color: C.primary }]}>Carburant</RNText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.actionBtn, { borderColor: C.primary }, pressed && styles.btnPressed]}
              onPress={() => router.push({ pathname: '/(tabs)/entitati/vigneta', params: { vehicleId: id } })}
            >
              <Ionicons name="globe-outline" size={16} color={C.primary} style={styles.actionIcon} />
              <RNText style={[styles.actionBtnText, { color: C.primary }]}>Vignetă</RNText>
            </Pressable>
          </RNView>
        )}

        {/* Add document */}
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
          onPress={() => router.push({ pathname: '/(tabs)/documente/add', params: { [entityKind]: id } })}
        >
          <Ionicons name="add" size={20} color="#fff" style={styles.actionIcon} />
          <RNText style={styles.primaryBtnText}>Adaugă document nou</RNText>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.btnPressed]}
          onPress={openLinkDoc}
        >
          <Ionicons name="link-outline" size={18} color={C.primary} style={styles.actionIcon} />
          <RNText style={[styles.secondaryBtnText, { color: C.primary }]}>Asociază document existent</RNText>
        </Pressable>

        {/* Delete */}
        <Pressable style={styles.deleteBtn} onPress={handleDelete}>
          <RNText style={styles.deleteBtnText}>Șterge entitate</RNText>
        </Pressable>
      </RNView>

      {/* ── Link existing document modal ── */}
      <Modal visible={linkDocVisible} animationType="slide" transparent onRequestClose={() => setLinkDocVisible(false)}>
        <RNView style={styles.modalOverlay}>
          <RNView style={[styles.modalContent, { backgroundColor: C.card }]}>
            <RNText style={[styles.modalTitle, { color: C.text }]}>Asociază document existent</RNText>
            {unlinkedDocs.length === 0 ? (
              <RNText style={[styles.modalLabel, { color: C.textSecondary, marginBottom: 16 }]}>
                Nu există documente nelegate disponibile.
              </RNText>
            ) : (
              <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                {unlinkedDocs.map(d => (
                  <Pressable
                    key={d.id}
                    style={[styles.linkDocRow, { borderBottomColor: C.border }]}
                    onPress={() => handleLinkDoc(d.id)}
                  >
                    <RNText style={[styles.linkDocType, { color: C.primary }]}>
                      {DOCUMENT_TYPE_LABELS[d.type] ?? d.type}
                    </RNText>
                    {d.note ? (
                      <RNText style={[styles.linkDocNote, { color: C.textSecondary }]} numberOfLines={1}>
                        {d.note}
                      </RNText>
                    ) : null}
                    {d.expiry_date ? (
                      <RNText style={[styles.linkDocNote, { color: C.textSecondary }]}>
                        Expiră: {d.expiry_date}
                      </RNText>
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Pressable style={[styles.modalCancelBtn, { borderColor: C.border, marginTop: 12 }]} onPress={() => setLinkDocVisible(false)}>
              <RNText style={[styles.modalCancelText, { color: C.text }]}>Anulare</RNText>
            </Pressable>
          </RNView>
        </RNView>
      </Modal>

      {/* ── Edit modal ── */}
      <Modal visible={editVisible} animationType="slide" transparent onRequestClose={() => setEditVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <RNView style={[styles.modalContent, { backgroundColor: C.card }]}>
            <RNText style={[styles.modalTitle, { color: C.text }]}>Editează entitate</RNText>

            {!isCard && (
              <>
                <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Nume</RNText>
                <ThemedTextInput
                  style={styles.modalInput}
                  placeholder="Nume"
                  value={editName}
                  onChangeText={setEditName}
                  editable={!editLoading}
                />
              </>
            )}

            {isCompany && (
              <>
                <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>CUI (opțional)</RNText>
                <ThemedTextInput style={styles.modalInput} placeholder="RO12345678" value={editCui} onChangeText={setEditCui} editable={!editLoading} />
                <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Nr. Registru Comerț (opțional)</RNText>
                <ThemedTextInput style={styles.modalInput} placeholder="J40/1234/2020" value={editRegCom} onChangeText={setEditRegCom} editable={!editLoading} />
              </>
            )}

            {isAnimal && (
              <>
                <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Specie</RNText>
                <ThemedTextInput
                  style={styles.modalInput}
                  placeholder="câine, pisică, papagal..."
                  value={editSpecies}
                  onChangeText={setEditSpecies}
                  editable={!editLoading}
                />
              </>
            )}

            {isCard && (
              <>
                <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Nickname</RNText>
                <ThemedTextInput style={styles.modalInput} placeholder="Nickname card" value={editNickname} onChangeText={setEditNickname} editable={!editLoading} />
                <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Ultimele 4 cifre</RNText>
                <ThemedTextInput style={styles.modalInput} placeholder="1234" value={editLast4} onChangeText={t => setEditLast4(t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" editable={!editLoading} />
                <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Expirare MM/AA (opțional)</RNText>
                <ThemedTextInput style={styles.modalInput} placeholder="12/28" value={editExpiry} onChangeText={setEditExpiry} editable={!editLoading} />
              </>
            )}

            <RNView style={styles.modalButtons}>
              <Pressable style={[styles.modalCancelBtn, { borderColor: C.border }]} onPress={() => setEditVisible(false)} disabled={editLoading}>
                <RNText style={[styles.modalCancelText, { color: C.text }]}>Anulare</RNText>
              </Pressable>
              <Pressable style={styles.modalSaveBtn} onPress={handleSaveEdit} disabled={editLoading}>
                <RNText style={styles.modalSaveText}>{editLoading ? 'Se salvează...' : 'Salvează'}</RNText>
              </Pressable>
            </RNView>
          </RNView>
        </KeyboardAvoidingView>
      </Modal>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  editBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 14 },
  editBtnText: { fontSize: 14, fontWeight: '500' },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, marginBottom: 10 },
  empty: { fontSize: 14, marginBottom: 16, opacity: 0.7 },

  // Doc row
  docRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  docRowPressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  docRowText: { flex: 1 },
  docType: { fontSize: 15, fontWeight: '500' },
  docMeta: { fontSize: 13, marginTop: 3 },

  // Bottom bar
  bottomBar: {
    paddingTop: 12,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    gap: 8,
  },
  vehicleActions: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 11,
  },
  actionIcon: { marginRight: 6 },
  actionBtnText: { fontSize: 14, fontWeight: '500' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#9EB567',
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#9EB567',
    borderRadius: 12,
    paddingVertical: 13,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '500' },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  deleteBtn: {
    borderWidth: 1,
    borderColor: '#E53935',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  linkDocRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  linkDocType: { fontSize: 15, fontWeight: '600' },
  linkDocNote: { fontSize: 13, marginTop: 2 },
  deleteBtnText: { color: '#E53935', fontSize: 15, fontWeight: '500' },

  // Modal
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
  modalLabel: { fontSize: 14, marginBottom: 6 },
  modalInput: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, marginBottom: 16 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalCancelBtn: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalCancelText: { fontSize: 16, opacity: 0.8 },
  modalSaveBtn: { flex: 1, backgroundColor: '#9EB567', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalSaveText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
