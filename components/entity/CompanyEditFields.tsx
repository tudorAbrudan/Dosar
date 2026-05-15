/**
 * Câmpuri suplimentare în modalul de editare firmă (CUI + Nr. Reg. Com).
 */
import { StyleSheet, View } from 'react-native';

import { ThemedTextInput, Text } from '@/components/Themed';
import Colors from '@/constants/Colors';

interface CompanyEditFieldsProps {
  scheme: 'light' | 'dark';
  cui: string;
  regCom: string;
  disabled: boolean;
  onChangeCui: (value: string) => void;
  onChangeRegCom: (value: string) => void;
}

export function CompanyEditFields({
  scheme,
  cui,
  regCom,
  disabled,
  onChangeCui,
  onChangeRegCom,
}: CompanyEditFieldsProps) {
  const C = Colors[scheme];
  return (
    <>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>CUI (opțional)</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="RO12345678"
          value={cui}
          onChangeText={onChangeCui}
          editable={!disabled}
        />
      </View>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>
          Nr. Registru Comerț (opțional)
        </Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="J40/1234/2020"
          value={regCom}
          onChangeText={onChangeRegCom}
          editable={!disabled}
        />
      </View>
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
