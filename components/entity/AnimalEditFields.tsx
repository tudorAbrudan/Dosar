/**
 * Câmp suplimentar în modalul de editare animal (specie).
 */
import { StyleSheet, View } from 'react-native';

import { ThemedTextInput, Text } from '@/components/Themed';
import Colors from '@/constants/Colors';

interface AnimalEditFieldsProps {
  scheme: 'light' | 'dark';
  species: string;
  disabled: boolean;
  onChangeSpecies: (value: string) => void;
}

export function AnimalEditFields({
  scheme,
  species,
  disabled,
  onChangeSpecies,
}: AnimalEditFieldsProps) {
  const C = Colors[scheme];
  return (
    <View>
      <Text style={[styles.label, { color: C.textSecondary }]}>Specie</Text>
      <ThemedTextInput
        style={styles.input}
        placeholder="câine, pisică, papagal..."
        value={species}
        onChangeText={onChangeSpecies}
        editable={!disabled}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 16,
  },
});
