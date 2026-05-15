/**
 * Pasul WELCOME din OnboardingWizard — listă de bullet-uri introductive
 * (local-first, fișiere atașate, AI opțional, backup opțional).
 */
import { StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';

const BULLETS = [
  'Datele și fișierele stau pe acest dispozitiv (SQLite, local). Nu există cont online obligatoriu.',
  'Poți atașa fotografii, scan-uri și fișiere PDF la orice document — totul rămâne local.',
  'Asistentul AI (chat) este opțional: îl activezi explicit din tabul Asistent. Poate fi configurat sau dezactivat oricând din Setări → Date și confidențialitate.',
  'Exportul de backup (JSON) este opțional și sub controlul tău (Drive, iCloud, Fișiere).',
];

interface WelcomeStepProps {
  scheme: 'light' | 'dark';
}

export function WelcomeStep({ scheme }: WelcomeStepProps) {
  const C = Colors[scheme];
  return (
    <View style={styles.bulletBlock}>
      {BULLETS.map((line, i) => (
        <View key={i} style={styles.bulletRow}>
          <Text style={[styles.bulletDot, { color: C.primary }]}>•</Text>
          <Text style={[styles.bulletText, { color: C.text }]}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bulletBlock: { gap: 12 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { fontSize: 18, lineHeight: 22, width: 14 },
  bulletText: { flex: 1, fontSize: 15, lineHeight: 22 },
});
