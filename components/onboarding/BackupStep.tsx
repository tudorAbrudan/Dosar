/**
 * Pasul BACKUP din OnboardingWizard — text scurt despre backup manual + link
 * la ghidul de suport.
 */
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { SUPPORT_URL } from '@/constants/AppLinks';
import { spacing } from '@/theme/layout';

interface BackupStepProps {
  scheme: 'light' | 'dark';
}

export function BackupStep({ scheme }: BackupStepProps) {
  const C = Colors[scheme];
  return (
    <View style={styles.block}>
      <Text style={[styles.body, { color: C.text }]}>
        Din Setări poți exporta toate datele într-un fișier JSON și atașamentele într-o arhivă.
        Recomandăm export periodic — la dezinstalare, datele dispar de pe dispozitiv.
      </Text>
      <Pressable
        onPress={() => Linking.openURL(SUPPORT_URL)}
        style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, marginTop: spacing.gap }]}
      >
        <Text style={[styles.link, { color: C.primary }]}>Deschide ghidul și suportul</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  body: { fontSize: 15, lineHeight: 22 },
  link: { fontSize: 15, fontWeight: '600' },
});
