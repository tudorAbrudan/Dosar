/**
 * Picker pentru tipul documentului — toggle row cu tipul curent + chip list
 * cu tipurile vizibile (din `useFilteredDocTypes`) și tipurile custom. Optional
 * banner „Alte tipuri (dezactivate în Setări)" când există tipuri ascunse.
 *
 * Caller-ul gestionează:
 *   - onSelectStandard(value): se rulează când userul alege un tip standard
 *   - onSelectCustom(id): se rulează când userul alege un tip custom
 *
 * Acest pattern permite caller-ului (`add.tsx`) să declanșeze logică OCR
 * (extractFieldsForType) la schimbarea tipului — fără ca picker-ul să cunoască
 * detaliile.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Colors from '@/constants/Colors';
import { primary, onPrimary } from '@/theme/colors';
import { DOCUMENT_TYPE_LABELS, type DocumentType } from '@/types';

interface DocTypeOption {
  value: DocumentType;
  label: string;
}

interface CustomTypeOption {
  id: string;
  name: string;
}

interface DocTypePickerProps {
  scheme: 'light' | 'dark';
  type: DocumentType;
  customTypeId: string | null;
  visibleStandardTypes: DocTypeOption[];
  customTypes: CustomTypeOption[];
  expanded: boolean;
  hasHiddenTypes?: boolean;
  onToggleExpanded: () => void;
  onSelectStandard: (value: DocumentType) => void;
  onSelectCustom: (id: string) => void;
  /** Optional CTA pentru linkul „Alte tipuri (dezactivate în Setări)". */
  onPressHiddenTypesLink?: () => void;
}

export function DocTypePicker({
  scheme,
  type,
  customTypeId,
  visibleStandardTypes,
  customTypes,
  expanded,
  hasHiddenTypes,
  onToggleExpanded,
  onSelectStandard,
  onSelectCustom,
  onPressHiddenTypesLink,
}: DocTypePickerProps) {
  const C = Colors[scheme];
  const currentLabel =
    type === 'custom'
      ? (customTypes.find(c => c.id === customTypeId)?.name ?? 'Tip personalizat')
      : (DOCUMENT_TYPE_LABELS[type] ?? type);

  return (
    <View>
      <Text style={[styles.label, { color: C.text }]}>Tip document</Text>
      <Pressable
        style={[styles.toggleRow, { borderColor: C.border }]}
        onPress={onToggleExpanded}
      >
        <Text style={[styles.toggleCurrent, { color: C.text }]}>{currentLabel}</Text>
        <Text style={[styles.toggleChevron, { color: C.textSecondary }]}>
          {expanded ? '▲' : '▼ Schimbă'}
        </Text>
      </Pressable>
      {expanded && (
        <>
          {hasHiddenTypes && onPressHiddenTypesLink && (
            <Pressable onPress={onPressHiddenTypesLink} style={styles.hiddenLink}>
              <Text style={[styles.hiddenLinkText, { color: C.textSecondary }]}>
                Alte tipuri (dezactivate în Setări) →
              </Text>
            </Pressable>
          )}
          <View style={styles.row}>
            {visibleStandardTypes.map(({ value, label }) => {
              const active = type === value;
              return (
                <Pressable
                  key={value}
                  style={[
                    styles.chip,
                    { borderColor: C.border },
                    active && styles.chipActive,
                  ]}
                  onPress={() => onSelectStandard(value)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: C.text },
                      active && styles.chipTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
            {customTypes.map(ct => {
              const active = type === 'custom' && customTypeId === ct.id;
              return (
                <Pressable
                  key={ct.id}
                  style={[
                    styles.chip,
                    { borderColor: C.border },
                    active && styles.chipActive,
                  ]}
                  onPress={() => onSelectCustom(ct.id)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: C.text },
                      active && styles.chipTextActive,
                    ]}
                  >
                    {ct.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, opacity: 0.7, marginTop: 14, marginBottom: 6 },
  toggleRow: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  toggleCurrent: { fontSize: 15, fontWeight: '600' },
  toggleChevron: { fontSize: 13 },
  hiddenLink: { paddingVertical: 6, marginBottom: 4 },
  hiddenLinkText: { fontSize: 13, fontStyle: 'italic' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: primary, borderColor: primary },
  chipText: { fontSize: 13 },
  chipTextActive: { color: onPrimary, fontWeight: '600' },
});
