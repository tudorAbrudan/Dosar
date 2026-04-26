import { useState } from 'react';
import {
  StyleSheet,
  Pressable,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  View as RNView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from '@react-navigation/elements';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { useEntities } from '@/hooks/useEntities';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { extractText, extractCardInfo } from '@/services/ocr';
import type { EntityType } from '@/types';

// Tipurile de entități clasice — fiecare are formular propriu de creație.
// `financial_account` e tratat separat (singleton hub, nu are formular de creație).
const MANUAL_ENTITY_TYPES: { key: EntityType; label: string }[] = [
  { key: 'person', label: 'Persoană' },
  { key: 'property', label: 'Proprietate' },
  { key: 'vehicle', label: 'Vehicul' },
  { key: 'card', label: 'Card' },
  { key: 'animal', label: 'Animal' },
  { key: 'company', label: 'Firmă' },
];

export default function AddEntityScreen() {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const params = useLocalSearchParams<{ type?: string }>();
  const [chosenType, setChosenType] = useState<EntityType | null>(
    (params.type as EntityType) || null
  );
  const type = chosenType || 'person';
  const {
    createPerson,
    createProperty,
    createVehicle,
    createCard,
    createAnimal,
    createCompany,
    refresh,
  } = useEntities();
  const { visibleEntityTypes, updateVisibleEntityTypes } = useVisibilitySettings();
  const ENTITY_TYPES = MANUAL_ENTITY_TYPES.filter(t => visibleEntityTypes.includes(t.key));
  const isFinanceHubActive = visibleEntityTypes.includes('financial_account');

  async function activateFinanceHub() {
    if (isFinanceHubActive) return;
    try {
      await updateVisibleEntityTypes([...visibleEntityTypes, 'financial_account']);
      router.replace('/(tabs)/entitati/financiar');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut activa hub-ul.');
    }
  }
  const headerHeight = useHeaderHeight();

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [last4, setLast4] = useState('');
  const [expiry, setExpiry] = useState('');
  const [species, setSpecies] = useState('');
  const [cui, setCui] = useState('');
  const [regCom, setRegCom] = useState('');
  const [loading, setLoading] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);

  async function scanCard() {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.9,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;
    setOcrLoading(true);
    try {
      const { text } = await extractText(result.assets[0].uri);
      const info = extractCardInfo(text);
      if (!info.last4 && !info.expiry) {
        Alert.alert('OCR card', 'Nu s-au putut extrage date. Completează manual.');
      } else {
        if (info.last4) setLast4(info.last4);
        if (info.expiry) setExpiry(info.expiry);
      }
    } catch {
      Alert.alert('Eroare OCR', 'Nu s-a putut citi cardul. Completează manual.');
    } finally {
      setOcrLoading(false);
    }
  }

  async function handleSubmit() {
    if (type === 'card') {
      if (!nickname.trim()) {
        Alert.alert('Eroare', 'Introdu un nickname pentru card.');
        return;
      }
    } else {
      if (!name.trim()) {
        Alert.alert('Eroare', 'Introdu un nume.');
        return;
      }
    }

    setLoading(true);
    try {
      if (type === 'person') await createPerson(name.trim());
      else if (type === 'property') await createProperty(name.trim());
      else if (type === 'vehicle') await createVehicle(name.trim());
      else if (type === 'animal') await createAnimal(name.trim(), species.trim() || 'câine');
      else if (type === 'company')
        await createCompany(name.trim(), cui.trim() || undefined, regCom.trim() || undefined);
      else await createCard(nickname.trim(), last4.trim() || '****', expiry.trim() || undefined);
      await refresh();
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)/entitati');
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut adăuga');
    } finally {
      setLoading(false);
    }
  }

  const isCard = type === 'card';
  const isAnimal = type === 'animal';
  const isCompany = type === 'company';

  if (!chosenType) {
    return (
      <View style={styles.container}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {(visibleEntityTypes.includes('vehicle') || visibleEntityTypes.includes('property')) && (
            <Text style={styles.label}>Wizard rapid</Text>
          )}
          {visibleEntityTypes.includes('vehicle') && (
            <Pressable
              style={({ pressed }) => [styles.wizardButton, pressed && styles.buttonPressed]}
              onPress={() => router.push('/(tabs)/entitati/wizard-masina')}
            >
              <Text style={styles.wizardButtonText}>Adaugă mașină (wizard)</Text>
            </Pressable>
          )}
          {visibleEntityTypes.includes('property') && (
            <Pressable
              style={({ pressed }) => [styles.wizardButton, pressed && styles.buttonPressed]}
              onPress={() => router.push('/(tabs)/entitati/wizard-proprietate')}
            >
              <Text style={styles.wizardButtonText}>Adaugă proprietate (wizard)</Text>
            </Pressable>
          )}

          <View style={[styles.separator, { backgroundColor: C.border }]} />
          <Text style={styles.label}>Sau adaugă manual</Text>
          {ENTITY_TYPES.map(({ key, label }) => (
            <Pressable
              key={key}
              style={({ pressed }) => [styles.typeButton, pressed && styles.buttonPressed]}
              onPress={() => setChosenType(key)}
            >
              <Text style={styles.typeButtonText}>{label}</Text>
            </Pressable>
          ))}

          <View style={[styles.separator, { backgroundColor: C.border }]} />
          <Text style={styles.label}>Hub-uri</Text>
          <Pressable
            style={({ pressed }) => [
              styles.hubButton,
              {
                borderColor: isFinanceHubActive ? C.border : primary,
                backgroundColor: isFinanceHubActive ? C.background : C.card,
                opacity: isFinanceHubActive ? 0.6 : 1,
              },
              pressed && !isFinanceHubActive && styles.buttonPressed,
            ]}
            onPress={activateFinanceHub}
            disabled={isFinanceHubActive}
          >
            <RNView style={[styles.hubIcon, { backgroundColor: '#E0F2F1' }]}>
              <Ionicons name="analytics" size={20} color="#00695C" />
            </RNView>
            <RNView style={styles.hubBody}>
              <Text style={[styles.hubTitle, { color: isFinanceHubActive ? C.text : primary }]}>
                Gestiune financiară
              </Text>
              <Text style={[styles.hubSub, { color: C.textSecondary }]}>
                {isFinanceHubActive
                  ? 'Deja adăugată — apare în lista de entități'
                  : 'Cheltuieli, venituri și conturi într-un singur loc'}
              </Text>
            </RNView>
            {isFinanceHubActive ? (
              <Ionicons name="checkmark-circle" size={20} color={primary} />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={primary} />
            )}
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.inner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!isCard && (
            <>
              <Text style={styles.label}>Nume</Text>
              <ThemedTextInput
                style={styles.input}
                placeholder={
                  type === 'company'
                    ? 'Denumire firmă (ex. S.C. ABC S.R.L.)'
                    : type === 'person'
                      ? 'ex. Diana Popescu'
                      : type === 'vehicle'
                        ? 'ex. Dacia Logan B 123 ABC'
                        : type === 'animal'
                          ? 'ex. Rex'
                          : 'ex. Apartament Str. Eminescu 5'
                }
                value={name}
                onChangeText={setName}
                editable={!loading}
              />
              <Text style={styles.hint}>
                {type === 'person'
                  ? 'Important pentru AI: folosește numele complet (Prenume Nume) exact cum apare în acte, pentru legarea automată a documentelor.'
                  : type === 'vehicle'
                    ? 'Important pentru AI: format recomandat Marcă Model Nr.înmatriculare (ex. Dacia Logan B 123 ABC), exact cum apare în talon și RCA.'
                    : type === 'property'
                      ? 'Important pentru AI: folosește adresa completă sau o descriere unică pentru potrivire automată cu actele de proprietate.'
                      : type === 'animal'
                        ? 'Important pentru AI: folosește numele exact din actele veterinare pentru legarea automată a vaccinurilor și consultațiilor.'
                        : type === 'company'
                          ? 'Important pentru AI: folosește denumirea exactă din documente (facturi, contracte) pentru potrivire automată.'
                          : null}
              </Text>
            </>
          )}
          {isCompany && (
            <>
              <Text style={styles.label}>CUI (opțional)</Text>
              <ThemedTextInput
                style={styles.input}
                placeholder="RO12345678"
                value={cui}
                onChangeText={setCui}
                editable={!loading}
              />
              <Text style={styles.label}>Nr. Registru Comerț (opțional)</Text>
              <ThemedTextInput
                style={styles.input}
                placeholder="J40/1234/2020"
                value={regCom}
                onChangeText={setRegCom}
                editable={!loading}
              />
            </>
          )}
          {isAnimal && (
            <>
              <Text style={styles.label}>Specie (opțional)</Text>
              <ThemedTextInput
                style={styles.input}
                placeholder="câine, pisică, papagal..."
                value={species}
                onChangeText={setSpecies}
                editable={!loading}
              />
            </>
          )}
          {isCard && (
            <>
              <Pressable
                style={({ pressed }) => [
                  styles.scanButton,
                  { backgroundColor: C.textSecondary },
                  pressed && styles.buttonPressed,
                ]}
                onPress={scanCard}
                disabled={ocrLoading || loading}
              >
                {ocrLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.scanButtonText}>Scanează cardul (OCR)</Text>
                )}
              </Pressable>
              <Text style={styles.label}>Nickname (ex. Card personal)</Text>
              <ThemedTextInput
                style={styles.input}
                placeholder="Nickname"
                value={nickname}
                onChangeText={setNickname}
                editable={!loading}
              />
              <Text style={styles.label}>Ultimele 4 cifre (opțional)</Text>
              <ThemedTextInput
                style={styles.input}
                placeholder="1234"
                value={last4}
                onChangeText={t => setLast4(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                editable={!loading}
              />
              <Text style={styles.label}>Expirare MM/AA (opțional)</Text>
              <ThemedTextInput
                style={styles.input}
                placeholder="12/28"
                value={expiry}
                onChangeText={setExpiry}
                editable={!loading}
              />
            </>
          )}
        </ScrollView>
      </Pressable>
      <BottomActionBar label="Salvează" onPress={handleSubmit} loading={loading} safeArea />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { padding: 24 },
  scrollContent: { padding: 24, paddingBottom: 40 },
  label: { fontSize: 14, marginBottom: 6, opacity: 0.9 },
  hint: { fontSize: 12, opacity: 0.55, marginTop: -14, marginBottom: 20, lineHeight: 17 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 20,
  },
  button: {
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonPressed: { opacity: 0.9 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  typeButton: {
    borderWidth: 1,
    borderColor: primary,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 12,
    alignItems: 'center',
  },
  typeButtonText: { fontSize: 16, fontWeight: '500', color: primary },
  scanButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  scanButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  wizardButton: {
    backgroundColor: primary,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 12,
    alignItems: 'center',
  },
  wizardButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  separator: {
    height: 1,
    marginVertical: 20,
  },
  hubButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
    gap: 12,
  },
  hubIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubBody: { flex: 1, gap: 2 },
  hubTitle: { fontSize: 15, fontWeight: '600' },
  hubSub: { fontSize: 12, lineHeight: 16 },
});
