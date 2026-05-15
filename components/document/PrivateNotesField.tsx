/**
 * Input pentru câmpul `private_notes` — date strict sensibile (CVV, PIN,
 * parole) care **nu pleacă niciodată la AI**. Vezi `.claude/rules/ai-privacy.md`.
 *
 * Vizual marcat ca sensibil: header cu lacăt + culoare `sensitive` din temă,
 * border + bg `sensitiveBorder` / `sensitiveBg`.
 *
 * Folosit identic în `documente/add.tsx` și `documente/edit.tsx`.
 */
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedTextInput } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { sensitive, sensitiveBorder, sensitiveBg } from '@/theme/colors';
import { greys } from '@/theme/iconColors';

interface PrivateNotesFieldProps {
  value: string;
  scheme: 'light' | 'dark';
  editable?: boolean;
  onChange: (value: string) => void;
}

export function PrivateNotesField({
  value,
  scheme,
  editable = true,
  onChange,
}: PrivateNotesFieldProps) {
  const C = Colors[scheme];
  return (
    <View>
      <View style={styles.labelRow}>
        <Ionicons name="lock-closed" size={14} color={sensitive} />
        <Text style={[styles.label, { color: sensitive }]}>Notă privată (opțional)</Text>
      </View>
      <Text style={[styles.hint, { color: C.textSecondary }]}>
        Rămâne pe acest telefon. Nu se trimite niciodată la asistentul AI. Potrivită pentru CVV,
        PIN, parole, coduri de acces.
      </Text>
      <ThemedTextInput
        style={[styles.input, styles.inputMultiline, styles.privateInput]}
        placeholder="Ex. CVV 123 · PIN 4821"
        placeholderTextColor={greys.text999}
        value={value}
        onChangeText={onChange}
        multiline
        scrollEnabled
        editable={editable}
        secureTextEntry={false}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, marginBottom: 2 },
  label: { fontSize: 13, fontWeight: '500' },
  hint: { fontSize: 12, marginBottom: 8, lineHeight: 16, opacity: 0.8 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  inputMultiline: { minHeight: 80, textAlignVertical: 'top' },
  privateInput: { borderColor: sensitiveBorder, backgroundColor: sensitiveBg },
});
