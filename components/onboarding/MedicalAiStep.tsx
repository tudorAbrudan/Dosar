import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, onPrimary } from '@/theme/colors';
import { setAiMedicalAllowed } from '@/services/settings';

interface Props {
  onNext(): void;
}

export function MedicalAiStep({ onNext }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  return (
    <View style={styles.container}>
      <Text style={[styles.body, { color: palette.text }]}>
        Dosar are o secțiune dedicată pentru documente medicale: analize, rețete, scrisori medicale,
        vaccinuri. Activează AI-ul medical ca să extragem automat valori (HDL, TSH etc.) și să poți
        întreba „Cum a evoluat HDL-ul?".
      </Text>
      <Text style={[styles.hint, { color: palette.textSecondary }]}>
        Datele medicale (Art. 9 GDPR) se criptează local cu AES-256-GCM. Nu pleacă la AI fără
        consimțământul tău per dosar. Poți activa/dezactiva oricând din Setări → Asistent AI.
      </Text>
      <Pressable
        onPress={async () => {
          await setAiMedicalAllowed(true);
          onNext();
        }}
        style={[styles.btn, { backgroundColor: primary }]}
        accessibilityRole="button"
      >
        <Text style={[styles.btnText, { color: onPrimary }]}>Activează</Text>
      </Pressable>
      <Pressable
        onPress={onNext}
        style={[styles.btnOutline, { borderColor: palette.border }]}
        accessibilityRole="button"
      >
        <Text style={[styles.btnOutlineText, { color: palette.text }]}>Mai târziu</Text>
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
  btnOutline: {
    borderWidth: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  btnOutlineText: { fontSize: 16 },
});
