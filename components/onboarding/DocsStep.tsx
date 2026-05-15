/**
 * Pasul DOCS din OnboardingWizard — userul alege tipurile de documente
 * vizibile în lista globală. Grupare semantică (Identitate, Vehicule,
 * Proprietate, Financiar, Animale, Firmă, Altele) cu marcaj „opțional"
 * pentru grupuri care nu conțin niciun tip din DEFAULT_VISIBLE_DOC_TYPES.
 *
 * Extras din OnboardingWizard.tsx.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary, onPrimary } from '@/theme/colors';
import { radius } from '@/theme/layout';
import {
  STANDARD_DOC_TYPES,
  DEFAULT_VISIBLE_DOC_TYPES,
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
} from '@/types';

// Onboarding-only grupare semantică (etichete UI). Folosim listă explicită
// pentru a controla ordinea afișării. La un tip nou: adaugă-l în grupul
// potrivit + în types/index.ts.
// eslint-disable-next-line local-rules/no-direct-doc-type-iteration
const DOC_GROUPS: { label: string; types: DocumentType[] }[] = [
  {
    label: 'Identitate',
    types: [
      'buletin',
      'pasaport',
      'permis_auto',
      'certificat_nastere',
      'certificat_casatorie',
      'certificat_botez',
      'card_sanatate',
    ],
  },
  {
    label: 'Vehicule',
    types: ['talon', 'carte_auto', 'rca', 'casco', 'itp', 'vigneta'],
  },
  {
    label: 'Proprietate',
    types: ['act_proprietate', 'cadastru', 'impozit_proprietate', 'pad', 'stingator_incendiu'],
  },
  {
    label: 'Financiar',
    types: [
      'factura',
      'contract',
      'card',
      'garantie',
      'abonament',
      'asigurare_personala',
      'bon_cumparaturi',
      'bon_parcare',
    ],
  },
  {
    label: 'Animale',
    types: ['vaccin_animal', 'deparazitare', 'vizita_vet'],
  },
  {
    label: 'Firmă',
    types: [
      'certificat_inregistrare',
      'autorizatie_activitate',
      'act_constitutiv',
      'certificat_tva',
      'asigurare_profesionala',
    ],
  },
  {
    label: 'Altele',
    types: ['bilet', 'altul'],
  },
];

interface DocsStepProps {
  scheme: 'light' | 'dark';
  selectedDocTypes: DocumentType[];
  onToggle: (docType: DocumentType) => void;
}

export function DocsStep({ scheme, selectedDocTypes, onToggle }: DocsStepProps) {
  const C = Colors[scheme];
  return (
    <>
      {DOC_GROUPS.map((group, gi) => {
        const groupTypes = group.types.filter(t => STANDARD_DOC_TYPES.includes(t));
        if (groupTypes.length === 0) return null;
        const isDefaultGroup = groupTypes.some(t => DEFAULT_VISIBLE_DOC_TYPES.includes(t));
        return (
          <View key={group.label}>
            <View style={styles.groupRow}>
              <Text style={[styles.groupLabel, { color: C.textSecondary }]}>
                {group.label.toUpperCase()}
              </Text>
              {!isDefaultGroup && (
                <Text style={[styles.optional, { color: C.textSecondary }]}>opțional</Text>
              )}
            </View>
            <View
              style={[styles.chipRow, gi < DOC_GROUPS.length - 1 && { marginBottom: 12 }]}
            >
              {groupTypes.map(docType => {
                const isSelected = selectedDocTypes.includes(docType);
                const isDefault = DEFAULT_VISIBLE_DOC_TYPES.includes(docType);
                return (
                  <Pressable
                    key={docType}
                    style={[
                      styles.chip,
                      isSelected
                        ? [styles.chipActive, { borderColor: C.primary }]
                        : {
                            borderColor: C.border,
                            backgroundColor: C.card,
                            opacity: isDefault ? 1 : 0.7,
                          },
                    ]}
                    onPress={() => onToggle(docType)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        { color: isSelected ? onPrimary : C.text },
                      ]}
                    >
                      {DOCUMENT_TYPE_LABELS[docType]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  groupRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 6,
    marginTop: 8,
  },
  groupLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  optional: { fontSize: 11, fontStyle: 'italic' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  chipActive: { backgroundColor: primary },
  chipText: { fontSize: 13, fontWeight: '500' },
});
