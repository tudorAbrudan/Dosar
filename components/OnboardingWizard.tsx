import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { ALL_ENTITY_TYPES, STANDARD_DOC_TYPES, ENTITY_DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS } from '@/types';
import type { EntityType, DocumentType } from '@/types';
import * as settings from '@/services/settings';

const ENTITY_LABELS: Record<EntityType, string> = {
  person: 'Persoană',
  vehicle: 'Vehicul',
  property: 'Proprietate',
  card: 'Card',
  animal: 'Animal',
};

const ENTITY_ICONS: Record<EntityType, string> = {
  person: '👤',
  vehicle: '🚗',
  property: '🏠',
  card: '💳',
  animal: '🐾',
};

const ENTITY_DESCRIPTIONS: Record<EntityType, string> = {
  person: 'Buletin, pașaport, permis, rețete',
  vehicle: 'Talon, RCA, ITP, CASCO, vignetă',
  property: 'Acte proprietate, facturi, PAD',
  card: 'Carduri bancare, abonamente',
  animal: 'Vaccinuri, deparazitare, vizite vet',
};

interface Props {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState(0); // 0 = entități, 1 = documente
  const [selectedEntities, setSelectedEntities] = useState<EntityType[]>([...ALL_ENTITY_TYPES]);
  const [selectedDocTypes, setSelectedDocTypes] = useState<DocumentType[]>([...STANDARD_DOC_TYPES]);

  function toggleEntity(entityType: EntityType) {
    setSelectedEntities(prev => {
      const isSelected = prev.includes(entityType);
      if (isSelected && prev.length <= 1) return prev; // minim 1
      return isSelected ? prev.filter(e => e !== entityType) : [...prev, entityType];
    });
  }

  function toggleDocType(docType: DocumentType) {
    setSelectedDocTypes(prev => {
      const isSelected = prev.includes(docType);
      if (isSelected && prev.length <= 1) return prev; // minim 1
      return isSelected ? prev.filter(d => d !== docType) : [...prev, docType];
    });
  }

  function handleNextStep() {
    if (step === 0) {
      const recommendedDocs = new Set<DocumentType>();
      selectedEntities.forEach(entity => {
        ENTITY_DOCUMENT_TYPES[entity].forEach(doc => recommendedDocs.add(doc));
      });
      setSelectedDocTypes(Array.from(recommendedDocs));
      setStep(1);
    }
  }

  async function handleComplete() {
    await settings.setVisibleEntityTypes(selectedEntities);
    await settings.setVisibleDocTypes(selectedDocTypes);
    await settings.setOnboardingDone();
    onComplete();
  }

  const relevantDocTypes = STANDARD_DOC_TYPES.filter(doc => {
    return selectedEntities.some(entity => ENTITY_DOCUMENT_TYPES[entity].includes(doc));
  });

  const otherDocTypes = STANDARD_DOC_TYPES.filter(doc => !relevantDocTypes.includes(doc));

  return (
    <View style={[styles.overlay, { backgroundColor: C.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16, borderBottomColor: C.border }]}>
        <Text style={[styles.stepIndicator, { color: C.textSecondary }]}>
          {step + 1} / 2
        </Text>
        <Text style={[styles.title, { color: C.text }]}>
          {step === 0 ? 'Ce vei gestiona?' : 'Ce documente te interesează?'}
        </Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>
          {step === 0
            ? 'Alege tipurile de entități pe care le vei folosi. Poți schimba oricând din Setări.'
            : 'Am preselectat documentele aferente entităților alese. Ajustează după nevoie.'}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={[styles.progressBar, { backgroundColor: C.border }]}>
        <View style={[styles.progressFill, { width: step === 0 ? '50%' : '100%' }]} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {step === 0 ? (
          ALL_ENTITY_TYPES.map(entityType => {
            const isSelected = selectedEntities.includes(entityType);
            return (
              <Pressable
                key={entityType}
                style={({ pressed }) => [
                  styles.entityCard,
                  { backgroundColor: C.card, shadowColor: C.cardShadow, borderColor: isSelected ? '#9EB567' : 'transparent' },
                  isSelected && styles.entityCardActive,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => toggleEntity(entityType)}
              >
                <View style={[styles.entityIcon, { backgroundColor: isSelected ? '#E8F5E9' : C.background }]}>
                  <Text style={styles.entityIconText}>{ENTITY_ICONS[entityType]}</Text>
                </View>
                <View style={styles.entityContent}>
                  <Text style={[styles.entityLabel, { color: C.text }]}>{ENTITY_LABELS[entityType]}</Text>
                  <Text style={[styles.entityDesc, { color: C.textSecondary }]}>{ENTITY_DESCRIPTIONS[entityType]}</Text>
                </View>
                <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </View>
              </Pressable>
            );
          })
        ) : (
          <>
            {relevantDocTypes.length > 0 && (
              <>
                <Text style={[styles.groupLabel, { color: C.textSecondary }]}>RECOMANDATE</Text>
                <View style={styles.chipRow}>
                  {relevantDocTypes.map(docType => {
                    const isSelected = selectedDocTypes.includes(docType);
                    return (
                      <Pressable
                        key={docType}
                        style={[
                          styles.chip,
                          isSelected
                            ? [styles.chipActive, { borderColor: '#9EB567' }]
                            : { borderColor: C.border, backgroundColor: C.card },
                        ]}
                        onPress={() => toggleDocType(docType)}
                      >
                        <Text style={[styles.chipText, { color: isSelected ? '#fff' : C.text }]}>
                          {DOCUMENT_TYPE_LABELS[docType]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
            {otherDocTypes.length > 0 && (
              <>
                <Text style={[styles.groupLabel, { color: C.textSecondary, marginTop: 16 }]}>ALTELE</Text>
                <View style={styles.chipRow}>
                  {otherDocTypes.map(docType => {
                    const isSelected = selectedDocTypes.includes(docType);
                    return (
                      <Pressable
                        key={docType}
                        style={[
                          styles.chip,
                          isSelected
                            ? [styles.chipActive, { borderColor: '#9EB567' }]
                            : { borderColor: C.border, backgroundColor: C.card },
                        ]}
                        onPress={() => toggleDocType(docType)}
                      >
                        <Text style={[styles.chipText, { color: isSelected ? '#fff' : C.text }]}>
                          {DOCUMENT_TYPE_LABELS[docType]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* Footer buttons */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16, borderTopColor: C.border, backgroundColor: C.background }]}>
        {step === 1 && (
          <Pressable
            style={({ pressed }) => [styles.btnBack, { borderColor: '#9EB567', opacity: pressed ? 0.7 : 1 }]}
            onPress={() => setStep(0)}
          >
            <Text style={[styles.btnBackText, { color: '#9EB567' }]}>Înapoi</Text>
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [styles.btnNext, { opacity: pressed ? 0.85 : 1 }]}
          onPress={step === 0 ? handleNextStep : handleComplete}
        >
          <Text style={styles.btnNextText}>
            {step === 0 ? 'Continuă' : 'Începe'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0, right: 0, top: 0, bottom: 0,
    zIndex: 1000,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  progressBar: {
    height: 3,
    width: '100%',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#9EB567',
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 24 },

  // Entity cards (step 1)
  entityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 2,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  entityCardActive: {},
  entityIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  entityIconText: { fontSize: 22 },
  entityContent: { flex: 1 },
  entityLabel: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
  entityDesc: { fontSize: 12, lineHeight: 16 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ccc',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  checkboxActive: { backgroundColor: '#9EB567', borderColor: '#9EB567' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700' },

  // Doc type chips (step 2)
  groupLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  chipActive: { backgroundColor: '#9EB567' },
  chipText: { fontSize: 13, fontWeight: '500' },

  // Footer
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  btnBack: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnBackText: { fontSize: 16, fontWeight: '600' },
  btnNext: {
    flex: 2,
    backgroundColor: '#9EB567',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnNextText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
