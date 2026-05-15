/**
 * Câmpurile specifice vehiculului în modalul de editare entitate:
 *   - poză (cu schimbare/eliminare)
 *   - număr înmatriculare
 *   - tip combustibil (chips)
 *
 * Extras din `entitati/[id].tsx`.
 */
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedTextInput } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { primary, statusColors, onPrimary } from '@/theme/colors';
import { toFileUri } from '@/services/fileUtils';

type FuelType = 'diesel' | 'benzina' | 'gpl' | 'electric';

const FUEL_OPTIONS: { value: FuelType; label: string }[] = [
  { value: 'diesel', label: 'Diesel' },
  { value: 'benzina', label: 'Benzină' },
  { value: 'gpl', label: 'GPL' },
  { value: 'electric', label: 'Electric' },
];

interface VehicleEditFieldsProps {
  scheme: 'light' | 'dark';
  photoUri: string | undefined;
  plate: string;
  fuelType: FuelType;
  disabled?: boolean;
  onPickPhoto: () => void;
  onRemovePhoto: () => void;
  onChangePlate: (value: string) => void;
  onChangeFuelType: (value: FuelType) => void;
}

export function VehicleEditFields({
  scheme,
  photoUri,
  plate,
  fuelType,
  disabled,
  onPickPhoto,
  onRemovePhoto,
  onChangePlate,
  onChangeFuelType,
}: VehicleEditFieldsProps) {
  const C = Colors[scheme];
  return (
    <>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Poză vehicul</Text>
        <View style={styles.photoRow}>
          {photoUri ? (
            <View style={styles.photoPreviewWrap}>
              <Image
                source={{ uri: toFileUri(photoUri) }}
                style={[styles.photoPreview, { backgroundColor: C.border }]}
              />
              <Pressable
                style={[styles.photoActionBtn, { backgroundColor: C.border }]}
                onPress={onPickPhoto}
              >
                <Text style={[styles.photoActionText, { color: C.text }]}>Schimbă</Text>
              </Pressable>
              <Pressable
                style={[styles.photoActionBtn, { marginLeft: 8, backgroundColor: C.border }]}
                onPress={onRemovePhoto}
              >
                <Text style={[styles.photoActionText, { color: statusColors.critical }]}>
                  Elimină
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.photoAddBtn} onPress={onPickPhoto}>
              <Ionicons name="camera-outline" size={18} color={primary} />
              <Text style={[styles.photoAddText, { color: primary }]}>Adaugă poză</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>
          Nr. înmatriculare (opțional)
        </Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="B 12 ABC"
          value={plate}
          onChangeText={t => onChangePlate(t.toUpperCase())}
          autoCapitalize="characters"
          editable={!disabled}
        />
      </View>

      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Tip combustibil</Text>
        <View style={styles.fuelRow}>
          {FUEL_OPTIONS.map(({ value, label }) => {
            const active = fuelType === value;
            return (
              <Pressable
                key={value}
                style={[
                  styles.fuelChip,
                  active
                    ? { backgroundColor: primary, borderColor: primary }
                    : { backgroundColor: C.card, borderColor: C.border },
                ]}
                onPress={() => onChangeFuelType(value)}
              >
                <Text
                  style={[styles.fuelChipText, { color: active ? onPrimary : C.text }]}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  photoRow: { marginBottom: 12 },
  photoPreviewWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photoPreview: { width: 72, height: 54, borderRadius: 8 },
  photoActionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  photoActionText: { fontSize: 13, fontWeight: '500' },
  photoAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  photoAddText: { fontSize: 14, fontWeight: '500' },
  fuelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  fuelChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  fuelChipText: { fontSize: 13, fontWeight: '500' },
});
