import { useEffect, useRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  Pressable,
  RefreshControl,
  Alert,
  Platform,
  View as RNView,
  Text as RNText,
  FlatList,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router, useLocalSearchParams, useFocusEffect, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ThemedTextInput } from '@/components/Themed';
import { FormSheetModal } from '@/components/ui/FormSheetModal';
import { BottomActionBar } from '@/components/BottomActionBar';
import type { BottomAction } from '@/components/BottomActionBar';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { useEntities } from '@/hooks/useEntities';
import { useDocuments } from '@/hooks/useDocuments';
import { getDocuments, linkDocumentToEntity } from '@/services/documents';
import { toFileUri, toRelativePath } from '@/services/fileUtils';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type { Document as DocType, DocumentType, Company } from '@/types';
import Animated, { useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { EntityStatusBar } from '@/components/EntityStatusBar';
import { VehicleParallaxHero, MAX_HERO_HEIGHT } from '@/components/VehicleParallaxHero';
import { PersonContactCard } from '@/components/entity/PersonContactCard';
import { LinkDocumentModal } from '@/components/entity/LinkDocumentModal';
import { DocumentRow } from '@/components/entity/DocumentRow';
import {
  VehicleMaintenanceSection,
  type VehicleMaintenanceSectionHandle,
} from '@/components/VehicleMaintenanceSection';
import { useVehicleStatus } from '@/hooks/useVehicleStatus';

export default function EntityDetailScreen() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const {
    persons,
    properties,
    vehicles,
    cards,
    animals,
    companies,
    refresh: refreshEntities,
    deletePerson,
    deleteProperty,
    deleteVehicle,
    deleteCard,
    deleteAnimal,
    deleteCompany,
    updatePerson,
    updateProperty,
    updateVehicle,
    updateCard,
    updateAnimal,
    updateCompany,
  } = useEntities();
  const { getDocumentsByEntity } = useDocuments();

  const [documents, setDocuments] = useState<DocType[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [entityName, setEntityName] = useState('');
  const [entityKind, setEntityKind] = useState<
    'person_id' | 'property_id' | 'vehicle_id' | 'card_id' | 'animal_id' | 'company_id'
  >('person_id');

  const [editVisible, setEditVisible] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editName, setEditName] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editLast4, setEditLast4] = useState('');
  const [editExpiry, setEditExpiry] = useState('');
  const [editSpecies, setEditSpecies] = useState('');
  const [editCui, setEditCui] = useState('');
  const [editRegCom, setEditRegCom] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editIban, setEditIban] = useState('');
  const [editPhotoUri, setEditPhotoUri] = useState<string | undefined>(undefined);
  const [editPlate, setEditPlate] = useState('');
  const [editFuelType, setEditFuelType] = useState<'diesel' | 'benzina' | 'gpl' | 'electric'>(
    'diesel'
  );
  const [contactExpanded, setContactExpanded] = useState(false);
  const [linkDocVisible, setLinkDocVisible] = useState(false);
  const [unlinkedDocs, setUnlinkedDocs] = useState<DocType[]>([]);

  const vehicle = vehicles.find(v => v.id === id);
  const autoEditTriggeredRef = useRef(false);
  const maintenanceRef = useRef<VehicleMaintenanceSectionHandle>(null);
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
  });
  const vehicleStatus = useVehicleStatus(entityKind === 'vehicle_id' ? vehicle : undefined);

  useEffect(() => {
    if (!id) return;
    const person = persons.find(p => p.id === id);
    const property = properties.find(p => p.id === id);
    const vehicle = vehicles.find(v => v.id === id);
    const card = cards.find(c => c.id === id);
    const animal = animals.find(a => a.id === id);
    const company = companies.find(c => c.id === id);
    if (person) {
      setEntityName(person.name);
      setEntityKind('person_id');
    } else if (property) {
      setEntityName(property.name);
      setEntityKind('property_id');
    } else if (vehicle) {
      setEntityName(vehicle.name);
      setEntityKind('vehicle_id');
    } else if (card) {
      setEntityName(card.nickname || 'Card');
      setEntityKind('card_id');
    } else if (animal) {
      setEntityName(animal.name);
      setEntityKind('animal_id');
    } else if (company) {
      setEntityName(company.name);
      setEntityKind('company_id');
    }
  }, [id, persons, properties, vehicles, cards, animals, companies]);

  async function loadDocs(kind: typeof entityKind, entityId: string) {
    if (!entityId) return;
    setLoading(true);
    setSelectedType(null);
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

  useEffect(() => {
    if (autoEditTriggeredRef.current) return;
    if (edit !== '1') return;
    if (!entityName) return;
    autoEditTriggeredRef.current = true;
    openEditModal();
    router.setParams({ edit: undefined });
  }, [edit, entityName]);

  useFocusEffect(
    useCallback(() => {
      refreshEntities();
      if (id && entityName) {
        loadDocs(entityKind, id);
      }
    }, [id, entityKind, entityName])
  );

  const refresh = () => {
    refreshEntities();
    if (id && entityName) loadDocs(entityKind, id);
  };

  async function openLinkDoc() {
    const all = await getDocuments();
    setUnlinkedDocs(
      all.filter(
        d =>
          !d.person_id &&
          !d.property_id &&
          !d.vehicle_id &&
          !d.card_id &&
          !d.animal_id &&
          !d.company_id
      )
    );
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
        text: 'Șterge',
        style: 'destructive',
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
      const person = persons.find(p => p.id === id);
      setEditName(entityName);
      if (entityKind === 'person_id' && person) {
        setEditPhone(person.phone ?? '');
        setEditEmail(person.email ?? '');
      }
    }
    if (entityKind === 'vehicle_id') {
      const vehicle = vehicles.find(v => v.id === id);
      setEditPhotoUri(vehicle?.photo_uri);
      setEditPlate(vehicle?.plate_number ?? '');
      setEditFuelType(vehicle?.fuel_type ?? 'diesel');
    }
    setEditVisible(true);
  };

  async function handlePickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisiune refuzată', 'Aplicația nu are acces la galerie.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
    });
    if (result.canceled || !result.assets || result.assets.length === 0) return;
    const asset = result.assets[0];
    const dir = `${FileSystem.documentDirectory}vehicles/`;
    try {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    } catch {
      // directorul există deja
    }
    // Filename unic per upload: forțează URI diferit → RN Image reîncarcă (fără cache vechi)
    const dest = `${dir}${id}-${Date.now()}.jpg`;
    await FileSystem.copyAsync({ from: asset.uri, to: dest });

    // Dacă există deja un fișier ales în aceeași sesiune de editare (neservit încă în DB),
    // șterge-l ca să nu lăsăm orfani pe disc.
    const savedUri = vehicle?.photo_uri;
    const prev = editPhotoUri;
    if (prev && prev !== savedUri) {
      try {
        await FileSystem.deleteAsync(toFileUri(prev), { idempotent: true });
      } catch {
        // best-effort
      }
    }
    setEditPhotoUri(toRelativePath(dest));
  }

  function handleRemovePhoto() {
    setEditPhotoUri(undefined);
  }

  async function handleCancelEdit() {
    // Curăță fișierul temporar dacă userul a ales o poză nouă dar nu a salvat
    if (isVehicle) {
      const savedUri = vehicle?.photo_uri;
      const prev = editPhotoUri;
      if (prev && prev !== savedUri) {
        try {
          await FileSystem.deleteAsync(toFileUri(prev), { idempotent: true });
        } catch {
          // best-effort
        }
      }
    }
    setEditVisible(false);
  }

  const handleSaveEdit = async () => {
    if (entityKind === 'card_id') {
      if (!editNickname.trim()) {
        Alert.alert('Eroare', 'Introdu un nickname.');
        return;
      }
    } else {
      if (!editName.trim()) {
        Alert.alert('Eroare', 'Introdu un nume.');
        return;
      }
    }
    setEditLoading(true);
    try {
      if (entityKind === 'person_id')
        await updatePerson(
          id!,
          editName.trim(),
          editPhone.trim() || undefined,
          editEmail.trim() || undefined
        );
      else if (entityKind === 'property_id') await updateProperty(id!, editName.trim());
      else if (entityKind === 'vehicle_id') {
        const previousPhoto = vehicle?.photo_uri;
        await updateVehicle(
          id!,
          editName.trim(),
          editPhotoUri ?? null,
          editPlate.trim() || null,
          editFuelType
        );
        // Șterge fișierul vechi dacă poza s-a schimbat sau a fost ștearsă
        if (previousPhoto && previousPhoto !== editPhotoUri) {
          try {
            await FileSystem.deleteAsync(toFileUri(previousPhoto), { idempotent: true });
          } catch {
            // best-effort
          }
        }
      } else if (entityKind === 'animal_id')
        await updateAnimal(id!, editName.trim(), editSpecies.trim() || 'câine');
      else if (entityKind === 'company_id')
        await updateCompany(
          id!,
          editName.trim(),
          editCui.trim() || undefined,
          editRegCom.trim() || undefined
        );
      else
        await updateCard(
          id!,
          editNickname.trim(),
          editLast4.trim() || '****',
          editExpiry.trim() || undefined
        );
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
  const isPerson = entityKind === 'person_id';

  // Tipuri unice prezente în documente (ordinea primei apariții)
  const presentTypes = Array.from(new Set(documents.map(d => d.type)));
  const showFilter = presentTypes.length >= 2;
  const visibleDocuments = selectedType
    ? documents.filter(d => d.type === selectedType)
    : documents;

  return (
    <RNView style={[styles.container, { backgroundColor: C.background }]}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <RNView style={{ alignItems: 'center' }}>
              <RNText style={{ fontSize: 16, fontWeight: '600', color: C.text }}>
                {entityName || 'Entitate'}
              </RNText>
              {isVehicle && vehicle?.plate_number ? (
                <RNText style={{ fontSize: 12, fontWeight: '500', color: C.textSecondary }}>
                  {vehicle.plate_number}
                </RNText>
              ) : null}
            </RNView>
          ),
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={{ paddingRight: 16 }}>
              <RNText style={{ color: primary, fontSize: 16 }}>‹ Înapoi</RNText>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable onPress={openEditModal} hitSlop={12} style={{ paddingLeft: 8 }}>
              <Ionicons name="create-outline" size={24} color={primary} />
            </Pressable>
          ),
        }}
      />

      {isVehicle && vehicle?.photo_uri && (
        <VehicleParallaxHero photoUri={toFileUri(vehicle.photo_uri)} scrollY={scrollY} />
      )}

      {/* ── Document list ── */}
      <Animated.ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          isVehicle && vehicle?.photo_uri ? { paddingTop: MAX_HERO_HEIGHT + 8 } : null,
        ]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={C.primary} />
        }
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {isPerson &&
          (() => {
            const person = persons.find(p => p.id === id);
            if (!person) return null;
            return (
              <PersonContactCard
                phone={person.phone}
                email={person.email}
                expanded={contactExpanded}
                scheme={scheme}
                onToggle={() => setContactExpanded(v => !v)}
              />
            );
          })()}

        {isVehicle && <EntityStatusBar items={vehicleStatus.items} />}

        {isVehicle && (
          <VehicleMaintenanceSection
            ref={maintenanceRef}
            vehicleId={id as string}
            vehicleName={vehicle?.name ?? entityName}
          />
        )}

        <RNText style={[styles.sectionTitle, { color: C.textSecondary }]}>DOCUMENTE LEGATE</RNText>

        {showFilter && (
          <FlatList
            data={[null, ...presentTypes]}
            keyExtractor={item => item ?? '__all__'}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterBar}
            contentContainerStyle={styles.filterBarContent}
            renderItem={({ item }) => {
              const active = selectedType === item;
              return (
                <Pressable
                  style={[
                    styles.filterChip,
                    active
                      ? { backgroundColor: primary }
                      : { backgroundColor: C.card, borderColor: C.border, borderWidth: 1 },
                  ]}
                  onPress={() => setSelectedType(item)}
                >
                  <RNText style={[styles.filterChipText, { color: active ? '#fff' : C.text }]}>
                    {item === null ? 'Toate' : (DOCUMENT_TYPE_LABELS[item as DocumentType] ?? item)}
                  </RNText>
                </Pressable>
              );
            }}
          />
        )}

        {visibleDocuments.length === 0 && !loading && (
          <RNText style={[styles.empty, { color: C.textSecondary }]}>
            {documents.length === 0
              ? 'Niciun document. Adaugă unul mai jos.'
              : 'Niciun document pentru tipul selectat.'}
          </RNText>
        )}

        {visibleDocuments.map(doc => (
          <DocumentRow
            key={doc.id}
            doc={doc}
            scheme={scheme}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/documente/[id]',
                params: { id: doc.id, from: 'entity', entityId: id },
              })
            }
          />
        ))}
      </Animated.ScrollView>

      {/* ── Bottom actions ── */}
      <BottomActionBar
        topActions={
          isVehicle
            ? ([
                {
                  icon: 'flame-outline',
                  label: 'Carburant',
                  onPress: () =>
                    router.push(
                      `/(tabs)/entitati/fuel?vehicleId=${id}&vehicleName=${encodeURIComponent(entityName)}`
                    ),
                },
                {
                  icon: 'construct-outline',
                  label: 'Mentenanță',
                  onPress: () => maintenanceRef.current?.openAddModal(),
                },
              ] as BottomAction[])
            : undefined
        }
        actions={[
          {
            icon: 'add-circle-outline',
            label: 'Adaugă doc',
            onPress: () =>
              router.push({ pathname: '/(tabs)/documente/add', params: { [entityKind]: id } }),
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

      <LinkDocumentModal
        visible={linkDocVisible}
        unlinkedDocs={unlinkedDocs}
        scheme={scheme}
        onClose={() => setLinkDocVisible(false)}
        onLink={handleLinkDoc}
      />

      {/* ── Edit modal ── */}
      <FormSheetModal
        visible={editVisible}
        title="Editează entitate"
        onClose={handleCancelEdit}
        onSave={handleSaveEdit}
        saving={editLoading}
      >
        {!isCard && (
          <RNView>
            <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Nume</RNText>
            <ThemedTextInput
              style={styles.modalInput}
              placeholder="Nume"
              value={editName}
              onChangeText={setEditName}
              editable={!editLoading}
            />
          </RNView>
        )}

        {isVehicle && (
          <>
            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Poză vehicul</RNText>
              <RNView style={styles.photoRow}>
                {editPhotoUri ? (
                  <RNView style={styles.photoPreviewWrap}>
                    <Image
                      source={{ uri: toFileUri(editPhotoUri) }}
                      style={[styles.photoPreview, { backgroundColor: C.border }]}
                    />
                    <Pressable
                      style={[styles.photoActionBtn, { backgroundColor: C.border }]}
                      onPress={handlePickPhoto}
                    >
                      <RNText style={[styles.photoActionText, { color: C.text }]}>Schimbă</RNText>
                    </Pressable>
                    <Pressable
                      style={[styles.photoActionBtn, { marginLeft: 8, backgroundColor: C.border }]}
                      onPress={handleRemovePhoto}
                    >
                      <RNText style={[styles.photoActionText, { color: statusColors.critical }]}>
                        Elimină
                      </RNText>
                    </Pressable>
                  </RNView>
                ) : (
                  <Pressable style={styles.photoAddBtn} onPress={handlePickPhoto}>
                    <Ionicons name="camera-outline" size={18} color={primary} />
                    <RNText style={[styles.photoAddText, { color: primary }]}>Adaugă poză</RNText>
                  </Pressable>
                )}
              </RNView>
            </RNView>

            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>
                Nr. înmatriculare (opțional)
              </RNText>
              <ThemedTextInput
                style={styles.modalInput}
                placeholder="B 12 ABC"
                value={editPlate}
                onChangeText={t => setEditPlate(t.toUpperCase())}
                autoCapitalize="characters"
                editable={!editLoading}
              />
            </RNView>

            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>
                Tip combustibil
              </RNText>
              <RNView style={styles.fuelTypeRow}>
                {(['diesel', 'benzina', 'gpl', 'electric'] as const).map(t => {
                  const label =
                    t === 'diesel'
                      ? 'Diesel'
                      : t === 'benzina'
                        ? 'Benzină'
                        : t === 'gpl'
                          ? 'GPL'
                          : 'Electric';
                  const active = editFuelType === t;
                  return (
                    <Pressable
                      key={t}
                      style={[
                        styles.fuelTypeChip,
                        active
                          ? { backgroundColor: primary, borderColor: primary }
                          : { backgroundColor: C.card, borderColor: C.border },
                      ]}
                      onPress={() => setEditFuelType(t)}
                    >
                      <RNText
                        style={[styles.fuelTypeChipText, { color: active ? '#fff' : C.text }]}
                      >
                        {label}
                      </RNText>
                    </Pressable>
                  );
                })}
              </RNView>
            </RNView>
          </>
        )}

        {isPerson && (
          <>
            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>
                Telefon (opțional)
              </RNText>
              <ThemedTextInput
                style={styles.modalInput}
                placeholder="0722 123 456"
                value={editPhone}
                onChangeText={setEditPhone}
                keyboardType="phone-pad"
                editable={!editLoading}
              />
            </RNView>
            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>
                Email (opțional)
              </RNText>
              <ThemedTextInput
                style={styles.modalInput}
                placeholder="email@exemplu.com"
                value={editEmail}
                onChangeText={setEditEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                editable={!editLoading}
              />
            </RNView>
          </>
        )}

        {isCompany && (
          <>
            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>
                CUI (opțional)
              </RNText>
              <ThemedTextInput
                style={styles.modalInput}
                placeholder="RO12345678"
                value={editCui}
                onChangeText={setEditCui}
                editable={!editLoading}
              />
            </RNView>
            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>
                Nr. Registru Comerț (opțional)
              </RNText>
              <ThemedTextInput
                style={styles.modalInput}
                placeholder="J40/1234/2020"
                value={editRegCom}
                onChangeText={setEditRegCom}
                editable={!editLoading}
              />
            </RNView>
          </>
        )}

        {isAnimal && (
          <RNView>
            <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Specie</RNText>
            <ThemedTextInput
              style={styles.modalInput}
              placeholder="câine, pisică, papagal..."
              value={editSpecies}
              onChangeText={setEditSpecies}
              editable={!editLoading}
            />
          </RNView>
        )}

        {isCard && (
          <>
            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>Nickname</RNText>
              <ThemedTextInput
                style={styles.modalInput}
                placeholder="Nickname card"
                value={editNickname}
                onChangeText={setEditNickname}
                editable={!editLoading}
              />
            </RNView>
            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>
                Ultimele 4 cifre
              </RNText>
              <ThemedTextInput
                style={styles.modalInput}
                placeholder="1234"
                value={editLast4}
                onChangeText={t => setEditLast4(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                editable={!editLoading}
              />
            </RNView>
            <RNView>
              <RNText style={[styles.modalLabel, { color: C.textSecondary }]}>
                Expirare MM/AA (opțional)
              </RNText>
              <ThemedTextInput
                style={styles.modalInput}
                placeholder="12/28"
                value={editExpiry}
                onChangeText={setEditExpiry}
                editable={!editLoading}
              />
            </RNView>
          </>
        )}
      </FormSheetModal>
    </RNView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, marginBottom: 10 },
  empty: { fontSize: 14, marginBottom: 16, opacity: 0.7 },

  // Contact info card
  contactCard: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  contactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  contactHeaderRight: { flexDirection: 'row', alignItems: 'center' },
  contactHeaderIcon: { marginRight: 8 },
  contactBody: { marginTop: 10 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 4,
  },
  contactRowPressed: { opacity: 0.6 },
  contactIcon: { marginRight: 8 },
  contactValue: { fontSize: 15 },

  // Filter chips
  filterBar: { marginBottom: 12 },
  filterBarContent: { gap: 8, paddingVertical: 2 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  filterChipText: { fontSize: 13, fontWeight: '500' },

  // Bottom bar
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  modalLabel: { fontSize: 14, marginBottom: 6 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 16,
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  modalCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  modalCancelText: { fontSize: 16, opacity: 0.8 },
  photoRow: {
    marginBottom: 16,
  },
  photoAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: primary,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 8,
  },
  photoAddText: {
    fontSize: 15,
    fontWeight: '600',
  },
  photoPreviewWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  photoPreview: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  photoActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  photoActionText: {
    fontSize: 13,
    fontWeight: '500',
  },
  fuelTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  fuelTypeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  fuelTypeChipText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
