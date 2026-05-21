/**
 * Câmpuri suplimentare în modalul de editare persoană (telefon + email + data nașterii).
 * Numele e gestionat separat în parent.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedTextInput } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { Text } from '@/components/Themed';
import { DatePickerField } from '@/components/DatePickerField';

interface PersonEditFieldsProps {
  scheme: 'light' | 'dark';
  phone: string;
  email: string;
  dateOfBirth: string;
  disabled: boolean;
  onChangePhone: (value: string) => void;
  onChangeEmail: (value: string) => void;
  onChangeDateOfBirth: (value: string) => void;
}

export function PersonEditFields({
  scheme,
  phone,
  email,
  dateOfBirth,
  disabled,
  onChangePhone,
  onChangeEmail,
  onChangeDateOfBirth,
}: PersonEditFieldsProps) {
  const C = Colors[scheme];
  return (
    <>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Telefon (opțional)</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="0722 123 456"
          value={phone}
          onChangeText={onChangePhone}
          keyboardType="phone-pad"
          editable={!disabled}
        />
      </View>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Email (opțional)</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="email@exemplu.com"
          value={email}
          onChangeText={onChangeEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          editable={!disabled}
        />
      </View>
      <DatePickerField
        label="Data nașterii (opțional)"
        value={dateOfBirth}
        onChange={onChangeDateOfBirth}
        disabled={disabled}
      />
    </>
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
