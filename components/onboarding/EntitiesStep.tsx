/**
 * Pasul ENTITIES din OnboardingWizard — pentru fiecare tip de entitate
 * (Persoană, Vehicul, Proprietate, Card, Animal, Firmă) afișează un card
 * pressable cu emoji, etichetă, descriere scurtă și checkbox.
 *
 * Extras din OnboardingWizard.tsx.
 */
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary, primaryMuted, onPrimary } from '@/theme/colors';
import { radius } from '@/theme/layout';
import {
  ALL_ENTITY_TYPES,
  ENTITY_TYPE_EMOJI,
  ENTITY_TYPE_LABELS,
  type EntityType,
} from '@/types';

// Onboarding-only descrieri (text scurt per entitate) — UI specific, păstrat aici.
// check-hardcoded-entities-disable-next-cluster
const ENTITY_DESCRIPTIONS: Record<EntityType, string> = {
  person: 'Buletin, pașaport, permis',
  vehicle: 'Talon, RCA, ITP, CASCO, vignetă',
  property: 'Acte proprietate, facturi, PAD',
  card: 'Carduri bancare, abonamente',
  animal: 'Vaccinuri, deparazitare, vizite vet',
  company: 'Certificat înregistrare, acte constitutive, TVA',
  medical_record: 'Analize, rețete, vaccinuri, imagistică',
};

interface EntitiesStepProps {
  scheme: 'light' | 'dark';
  selectedEntities: EntityType[];
  onToggle: (entityType: EntityType) => void;
}

export function EntitiesStep({ scheme, selectedEntities, onToggle }: EntitiesStepProps) {
  const C = Colors[scheme];
  return (
    <>
      {ALL_ENTITY_TYPES.map(entityType => {
        const isSelected = selectedEntities.includes(entityType);
        return (
          <Pressable
            key={entityType}
            style={({ pressed }) => [
              styles.card,
              {
                backgroundColor: C.card,
                shadowColor: C.cardShadow,
                borderColor: isSelected ? C.primary : 'transparent',
              },
              pressed && { opacity: 0.85 },
            ]}
            onPress={() => onToggle(entityType)}
          >
            <View
              style={[
                styles.icon,
                { backgroundColor: isSelected ? primaryMuted : C.background },
              ]}
            >
              <Text style={styles.iconText}>{ENTITY_TYPE_EMOJI[entityType]}</Text>
            </View>
            <View style={styles.content}>
              <Text style={[styles.label, { color: C.text }]}>
                {ENTITY_TYPE_LABELS[entityType]}
              </Text>
              <Text style={[styles.desc, { color: C.textSecondary }]}>
                {ENTITY_DESCRIPTIONS[entityType]}
              </Text>
            </View>
            <View
              style={[
                styles.checkbox,
                { borderColor: C.border },
                isSelected && styles.checkboxActive,
              ]}
            >
              {isSelected && <Text style={styles.checkmark}>✓</Text>}
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 2,
    marginBottom: 10,
    gap: 12,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4 },
      android: { elevation: 1 },
    }),
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { fontSize: 26 },
  content: { flex: 1, gap: 2 },
  label: { fontSize: 16, fontWeight: '600' },
  desc: { fontSize: 13, lineHeight: 17 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: primary, borderColor: primary },
  checkmark: { color: onPrimary, fontSize: 14, fontWeight: '700' },
});
