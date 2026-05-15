/**
 * Câmpuri suplimentare în modalul de editare card (nickname + last4 + expirare).
 */
import { StyleSheet, View } from 'react-native';

import { ThemedTextInput, Text } from '@/components/Themed';
import Colors from '@/constants/Colors';

interface CardEditFieldsProps {
  scheme: 'light' | 'dark';
  nickname: string;
  last4: string;
  expiry: string;
  disabled: boolean;
  onChangeNickname: (value: string) => void;
  onChangeLast4: (value: string) => void;
  onChangeExpiry: (value: string) => void;
}

export function CardEditFields({
  scheme,
  nickname,
  last4,
  expiry,
  disabled,
  onChangeNickname,
  onChangeLast4,
  onChangeExpiry,
}: CardEditFieldsProps) {
  const C = Colors[scheme];
  return (
    <>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Nickname</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="Nickname card"
          value={nickname}
          onChangeText={onChangeNickname}
          editable={!disabled}
        />
      </View>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Ultimele 4 cifre</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="1234"
          value={last4}
          onChangeText={t => onChangeLast4(t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          editable={!disabled}
        />
      </View>
      <View>
        <Text style={[styles.label, { color: C.textSecondary }]}>Expirare MM/AA (opțional)</Text>
        <ThemedTextInput
          style={styles.input}
          placeholder="12/28"
          value={expiry}
          onChangeText={onChangeExpiry}
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
