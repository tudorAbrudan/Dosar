/**
 * Pasul SECURITY din OnboardingWizard — bullet-uri recomandări de securitate
 * + buton „Activează PIN acum" (deschide AppLockPinModal în parent).
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { radius } from '@/theme/layout';

const BULLETS = [
  'Recomandăm Face ID / Touch ID sau PIN pentru a limita accesul la acte și documente.',
  'Nu salva codul CVV al cardurilor sau parole în câmpurile de note.',
  'Fișierele sunt izolate în sandbox-ul sistemului; alte aplicații nu le văd.',
];

interface SecurityStepProps {
  scheme: 'light' | 'dark';
  onActivatePin: () => void;
}

export function SecurityStep({ scheme, onActivatePin }: SecurityStepProps) {
  const C = Colors[scheme];
  return (
    <>
      <View style={styles.bulletBlock}>
        {BULLETS.map((line, i) => (
          <View key={i} style={styles.bulletRow}>
            <Text style={[styles.bulletDot, { color: C.primary }]}>•</Text>
            <Text style={[styles.bulletText, { color: C.text }]}>{line}</Text>
          </View>
        ))}
      </View>
      {Platform.OS === 'web' ? (
        <Text style={[styles.webNote, { color: C.textSecondary }]}>
          Pe web, blocarea cu PIN / biometrie nu este disponibilă.
        </Text>
      ) : (
        <Pressable
          style={({ pressed }) => [
            styles.secondaryCta,
            { borderColor: C.primary, opacity: pressed ? 0.85 : 1 },
          ]}
          onPress={onActivatePin}
        >
          <Text style={[styles.secondaryCtaText, { color: C.primary }]}>Activează PIN acum</Text>
        </Pressable>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  bulletBlock: { gap: 12 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { fontSize: 18, lineHeight: 22, width: 14 },
  bulletText: { flex: 1, fontSize: 15, lineHeight: 22 },
  webNote: { marginTop: 16, fontSize: 14, lineHeight: 20 },
  secondaryCta: {
    marginTop: 18,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryCtaText: { fontSize: 15, fontWeight: '600' },
});
