import { View, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { statusColors } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { STANDARD_DOC_TYPES, DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType } from '@/types';
import { AppButton } from '@/components/ui/AppButton';
import { SectionCard } from './SectionCard';
import { InfoRow } from './InfoRow';
import { ChoiceChip, ChoiceChipRow } from './ChoiceChip';

interface CustomType {
  id: string;
  name: string;
}

interface VizibilitateDocTypesSectionProps {
  visibleDocTypes: DocumentType[];
  customTypes: CustomType[];
  newTypeName: string;
  scheme: 'light' | 'dark';
  onToggleDocType: (type: DocumentType) => void;
  onChangeNewTypeName: (value: string) => void;
  onAddCustomType: () => void;
  onDeleteCustomType: (id: string, name: string) => void;
}

/** Tipurile de documente din lista globală + tipurile proprii. Două secțiuni pliabile. */
export function VizibilitateDocTypesSection({
  visibleDocTypes,
  customTypes,
  newTypeName,
  scheme,
  onToggleDocType,
  onChangeNewTypeName,
  onAddCustomType,
  onDeleteCustomType,
}: VizibilitateDocTypesSectionProps) {
  const C = Colors[scheme];
  return (
    <>
      <SectionCard
        title="Tipuri documente active"
        scheme={scheme}
        collapsible
        description="Alege ce tipuri de documente să apară în lista globală de adăugare. Când adaugi un document direct pe o entitate (mașină, casă, persoană…), tipurile relevante pentru acea entitate sunt mereu vizibile, indiferent de selecția de aici."
      >
        <ChoiceChipRow>
          {/* Acesta E ecranul unde user-ul setează vizibilitatea, deci
              iterăm peste TOATE tipurile (sursa universului). */}
          {/* eslint-disable-next-line local-rules/no-direct-doc-type-iteration */}
          {STANDARD_DOC_TYPES.map(docType => (
            <ChoiceChip
              key={docType}
              label={DOCUMENT_TYPE_LABELS[docType]}
              selected={visibleDocTypes.includes(docType)}
              onPress={() => onToggleDocType(docType)}
              scheme={scheme}
            />
          ))}
        </ChoiceChipRow>
      </SectionCard>

      <SectionCard
        title="Tipuri personalizate"
        scheme={scheme}
        collapsible
        description={
          'Adaugă tipuri proprii de documente (ex: „Asigurare viață", „Concediu medical"). ' +
          'Tipurile de entități (Persoană, Vehicul, Proprietate etc.) sunt fixe și nu pot fi modificate.'
        }
      >
        {customTypes.map(ct => (
          <InfoRow
            key={ct.id}
            icon="document-text-outline"
            iconBg={iconColors.neutral.bg}
            iconColor={iconColors.neutral.fg}
            label={ct.name}
            right={
              <Pressable
                onPress={() => onDeleteCustomType(ct.id, ct.name)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Șterge tipul ${ct.name}`}
              >
                <Ionicons name="trash-outline" size={18} color={statusColors.critical} />
              </Pressable>
            }
            scheme={scheme}
          />
        ))}
        <View style={styles.addTypeRow}>
          <TextInput
            style={[
              styles.addTypeInput,
              { color: C.text, borderColor: C.border, backgroundColor: C.background },
            ]}
            placeholder="Nume tip nou (ex: Asigurare viață)"
            placeholderTextColor={C.textSecondary}
            value={newTypeName}
            onChangeText={onChangeNewTypeName}
            returnKeyType="done"
            onSubmitEditing={onAddCustomType}
          />
          <AppButton
            title="Adaugă"
            onPress={onAddCustomType}
            disabled={!newTypeName.trim()}
            style={styles.addTypeBtn}
          />
        </View>
      </SectionCard>
    </>
  );
}

const styles = StyleSheet.create({
  addTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  addTypeInput: {
    flex: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  addTypeBtn: { paddingHorizontal: 18 },
});
