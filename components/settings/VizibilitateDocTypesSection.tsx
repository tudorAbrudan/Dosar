import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';
import { STANDARD_DOC_TYPES, DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType } from '@/types';

interface CustomType {
  id: string;
  name: string;
}

interface VizibilitateDocTypesSectionProps {
  visibleDocTypes: DocumentType[];
  customTypes: CustomType[];
  collapsed: boolean;
  newTypeName: string;
  scheme: 'light' | 'dark';
  onToggleCollapsed: () => void;
  onToggleDocType: (type: DocumentType) => void;
  onChangeNewTypeName: (value: string) => void;
  onAddCustomType: () => void;
  onDeleteCustomType: (id: string, name: string) => void;
}

export function VizibilitateDocTypesSection({
  visibleDocTypes,
  customTypes,
  collapsed,
  newTypeName,
  scheme,
  onToggleCollapsed,
  onToggleDocType,
  onChangeNewTypeName,
  onAddCustomType,
  onDeleteCustomType,
}: VizibilitateDocTypesSectionProps) {
  const C = Colors[scheme];
  return (
    <>
      <Pressable style={styles.header} onPress={onToggleCollapsed}>
        <Text style={[styles.label, { color: C.textSecondary }]}>TIPURI DOCUMENTE ACTIVE</Text>
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={14}
          color={C.textSecondary}
        />
      </Pressable>
      {!collapsed && (
        <>
          <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
            <Text style={[styles.hint, { color: C.textSecondary }]}>
              Alege ce tipuri de documente să apară în lista globală de adăugare. Când adaugi un
              document direct pe o entitate (mașină, casă, persoană…), tipurile relevante pentru
              acea entitate sunt mereu vizibile, indiferent de selecția de aici.
            </Text>
            <View style={styles.chipRow}>
              {/* Acesta E ecranul unde user-ul setează vizibilitatea, deci
                  iterăm peste TOATE tipurile (sursa universului). */}
              {/* eslint-disable-next-line local-rules/no-direct-doc-type-iteration */}
              {STANDARD_DOC_TYPES.map(docType => {
                const isActive = visibleDocTypes.includes(docType);
                return (
                  <Pressable
                    key={docType}
                    style={[
                      styles.chip,
                      isActive
                        ? [styles.chipActive, { borderColor: primary }]
                        : { borderColor: C.border },
                    ]}
                    onPress={() => onToggleDocType(docType)}
                  >
                    <Text style={[styles.chipText, { color: isActive ? '#fff' : C.textSecondary }]}>
                      {DOCUMENT_TYPE_LABELS[docType]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text style={[styles.label, { color: C.textSecondary, marginTop: 16, marginBottom: 8, marginLeft: 4 }]}>
            TIPURI PERSONALIZATE
          </Text>
          <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
            <Text style={[styles.hint, { color: C.textSecondary }]}>
              Adaugă tipuri proprii de documente (ex: „Asigurare viață", „Concediu medical").
              Tipurile de entități (Persoană, Vehicul, Proprietate etc.) sunt fixe și nu pot fi
              modificate.
            </Text>
            {customTypes.map((ct, idx) => (
              <View
                key={ct.id}
                style={[
                  styles.customTypeRow,
                  { borderBottomColor: C.border },
                  idx === customTypes.length - 1 && styles.customTypeRowLast,
                ]}
              >
                <Text style={[styles.customTypeName, { color: C.text }]}>{ct.name}</Text>
                <Pressable
                  onPress={() => onDeleteCustomType(ct.id, ct.name)}
                  hitSlop={8}
                  accessibilityLabel={`Șterge tipul ${ct.name}`}
                >
                  <Ionicons name="trash-outline" size={18} color={statusColors.critical} />
                </Pressable>
              </View>
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
              <Pressable
                style={[styles.addTypeBtn, !newTypeName.trim() && styles.addTypeBtnDisabled]}
                onPress={onAddCustomType}
                disabled={!newTypeName.trim()}
              >
                <Text style={styles.addTypeBtnText}>Adaugă</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
    marginRight: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flex: 1,
  },
  card: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: primary },
  chipText: { fontSize: 13, fontWeight: '500' },
  customTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  customTypeRowLast: { borderBottomWidth: 0 },
  customTypeName: { fontSize: 15, flex: 1 },
  addTypeRow: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 6 },
  addTypeInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  addTypeBtn: {
    backgroundColor: primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  addTypeBtnDisabled: { opacity: 0.35 },
  addTypeBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
