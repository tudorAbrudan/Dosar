/**
 * Pasul SUMMARY din OnboardingWizard — card cu sumarul setărilor alese
 * de utilizator pe parcursul wizardului.
 */
import { Platform, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import * as aiProvider from '@/services/aiProvider';
import type { AiProviderType } from '@/services/aiProvider';
import { ENTITY_TYPE_LABELS } from '@/types';
import type { DocumentType, EntityType } from '@/types';
import { radius } from '@/theme/layout';

type ThemePref = 'auto' | 'light' | 'dark';

interface SummaryStepProps {
  scheme: 'light' | 'dark';
  themePref: ThemePref;
  selectedEntities: EntityType[];
  selectedDocTypes: DocumentType[];
  pushEnabled: boolean;
  notifDays: number;
  lockEnabled: boolean;
  aiProviderChoice: AiProviderType;
}

export function SummaryStep({
  scheme,
  themePref,
  selectedEntities,
  selectedDocTypes,
  pushEnabled,
  notifDays,
  lockEnabled,
  aiProviderChoice,
}: SummaryStepProps) {
  const C = Colors[scheme];
  return (
    <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <Text style={[styles.line, { color: C.text }]}>
        <Text style={styles.key}>Temă: </Text>
        {themePref === 'auto' ? 'Automat' : themePref === 'light' ? 'Clar' : 'Întunecat'}
      </Text>
      <Text style={[styles.line, { color: C.text }]}>
        <Text style={styles.key}>Entități: </Text>
        {selectedEntities.map(e => ENTITY_TYPE_LABELS[e]).join(', ')}
      </Text>
      <Text style={[styles.line, { color: C.text }]}>
        <Text style={styles.key}>Tipuri documente vizibile: </Text>
        {selectedDocTypes.length}
      </Text>
      <Text style={[styles.line, { color: C.text }]}>
        <Text style={styles.key}>Notificări expirări: </Text>
        {pushEnabled ? `Da (${notifDays} zile înainte)` : 'Nu'}
      </Text>
      <Text style={[styles.line, { color: C.text }]}>
        <Text style={styles.key}>Blocare aplicație: </Text>
        {lockEnabled ? 'Activă (PIN / biometrie)' : 'Nu'}
      </Text>
      <Text style={[styles.line, { color: C.text }]}>
        <Text style={styles.key}>Asistent AI: </Text>
        {aiProvider.PROVIDER_DEFAULTS[aiProviderChoice]?.label ?? aiProviderChoice}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: 16,
    gap: 10,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  line: { fontSize: 14, lineHeight: 20 },
  key: { fontWeight: '700' },
});
