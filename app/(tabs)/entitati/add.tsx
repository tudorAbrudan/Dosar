import { useState } from 'react';
import { StyleSheet, Pressable, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Text, View, ThemedTextInput } from '@/components/Themed';
import { primary } from '@/theme/colors';
import { useEntities } from '@/hooks/useEntities';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import { extractText, extractCardInfo } from '@/services/ocr';
import type { EntityType } from '@/types';

const ALL_ENTITY_TYPES: { key: EntityType; label: string }[] = [
  { key: 'person', label: 'Persoană' },
  { key: 'property', label: 'Proprietate' },
  { key: 'vehicle', label: 'Vehicul' },
  { key: 'card', label: 'Card' },
  { key: 'animal', label: 'Animal' },
];

export default function AddEntityScreen() {
  const params = useLocalSearchParams<{ type?: string }>();
  const [chosenType, setChosenType] = useState<EntityType | null>((params.type as EntityType) || null);
  const type = chosenType || 'person';
  const { createPerson, createProperty, createVehicle, createCard, createAnimal, refresh } = useEntities();
  const { visibleEntityTypes } = useVisibilitySettings();
  const ENTITY_TYPES = ALL_ENTITY_TYPES.filter(t => visibleEntityTypes.includes(t.key));

  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [last4, setLast4] = useState('');
  const [expiry, setExpiry] = useState('');
  const [species, setSpecies] = useState('');
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
      else await createCard(nickname.trim(), last4.trim() || '****', expiry.trim() || undefined);
      await refresh();
      router.back();
    } catch (e) {
      Alert.alert('Eroare', e instanceof Error ? e.message : 'Nu s-a putut adăuga');
    } finally {
      setLoading(false);
    }
  }

  const isCard = type === 'card';
  const isAnimal = type === 'animal';

  if (!chosenType) {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          {(visibleEntityTypes.includes('vehicle') || visibleEntityTypes.includes('property')) && (
            <Text style={styles.label}>Wizard rapid</Text>
          )}
          {visibleEntityTypes.includes('vehicle') && (
            <Pressable
              style={({ pressed }) => [styles.wizardButton, pressed && styles.buttonPressed]}
              onPress={() => router.push('/(tabs)/entitati/wizard-masina')}>
              <Text style={styles.wizardButtonText}>Adaugă mașină (wizard)</Text>
            </Pressable>
          )}
          {visibleEntityTypes.includes('property') && (
            <Pressable
              style={({ pressed }) => [styles.wizardButton, pressed && styles.buttonPressed]}
              onPress={() => router.push('/(tabs)/entitati/wizard-proprietate')}>
              <Text style={styles.wizardButtonText}>Adaugă proprietate (wizard)</Text>
            </Pressable>
          )}

          <View style={styles.separator} />
          <Text style={styles.label}>Sau adaugă manual</Text>
          {ENTITY_TYPES.map(({ key, label }) => (
            <Pressable
              key={key}
              style={({ pressed }) => [styles.typeButton, pressed && styles.buttonPressed]}
              onPress={() => setChosenType(key)}>
              <Text style={styles.typeButtonText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        {!isCard && (
          <>
            <Text style={styles.label}>Nume</Text>
            <ThemedTextInput
            style={styles.input}
            placeholder={type === 'person' ? 'Nume persoană' : type === 'vehicle' ? 'Mașină (ex. Dacia Logan)' : type === 'animal' ? 'Nume animal (ex. Rex)' : 'Proprietate (ex. Apartament X)'}
            placeholderTextColor="#999"
            value={name}
            onChangeText={setName}
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
              placeholderTextColor="#999"
              value={species}
              onChangeText={setSpecies}
              editable={!loading}
            />
          </>
        )}
        {isCard && (
          <>
            <Pressable
              style={({ pressed }) => [styles.scanButton, pressed && styles.buttonPressed]}
              onPress={scanCard}
              disabled={ocrLoading || loading}>
              {ocrLoading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.scanButtonText}>Scanează cardul (OCR)</Text>
              }
            </Pressable>
            <Text style={styles.label}>Nickname (ex. Card personal)</Text>
            <ThemedTextInput
              style={styles.input}
              placeholder="Nickname"
              placeholderTextColor="#999"
              value={nickname}
              onChangeText={setNickname}
              editable={!loading}
            />
            <Text style={styles.label}>Ultimele 4 cifre (opțional)</Text>
            <ThemedTextInput
              style={styles.input}
              placeholder="1234"
              placeholderTextColor="#999"
              value={last4}
              onChangeText={(t) => setLast4(t.replace(/\D/g, '').slice(0, 4))}
              keyboardType="number-pad"
              editable={!loading}
            />
            <Text style={styles.label}>Expirare MM/AA (opțional)</Text>
            <ThemedTextInput
              style={styles.input}
              placeholder="12/28"
              placeholderTextColor="#999"
              value={expiry}
              onChangeText={setExpiry}
              editable={!loading}
            />
          </>
        )}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={handleSubmit}
          disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Se salvează...' : 'Salvează'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, padding: 24 },
  label: { fontSize: 14, marginBottom: 6, opacity: 0.9 },
  input: {
    borderWidth: 1,
    borderColor: '#e0e0e0',
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
    backgroundColor: '#555',
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
    backgroundColor: '#e0e0e0',
    marginVertical: 20,
  },
});
