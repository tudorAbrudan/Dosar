import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, onPrimary } from '@/theme/colors';

interface Props {
  onNext(): void;
}

export function MedicalAiStep({ onNext }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  return (
    <View style={styles.container}>
      <Text style={[styles.body, { color: palette.text }]}>
        Dosar are o secțiune separată pentru documente medicale: analize, rețete, scrisori medicale,
        vaccinuri. Fiecare dosar medical are asistentul lui AI, care extrage valori (HDL, TSH etc.)
        și răspunde la întrebări ca „Cum a evoluat HDL-ul?".
      </Text>
      <Text style={[styles.hint, { color: palette.textSecondary }]}>
        Datele medicale (Art. 9 GDPR) nu ajung la AI fără acordul tău, pe care îl dai separat în
        fiecare dosar. Asistentul general din tab-ul „Asistent" nu le vede niciodată.
      </Text>
      <Pressable
        onPress={onNext}
        style={[styles.btn, { backgroundColor: primary }]}
        accessibilityRole="button"
      >
        <Text style={[styles.btnText, { color: onPrimary }]}>Am înțeles</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 16 },
  body: { fontSize: 15, lineHeight: 22 },
  hint: { fontSize: 13, lineHeight: 20 },
  btn: {
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnText: { fontWeight: '600', fontSize: 16 },
});
