/**
 * Randează input-urile pentru câmpurile specifice tipului de document
 * (definite în `types/documentFields.ts`). Folosit identic în add.tsx și
 * edit.tsx — doar callback-urile diferă.
 */
import { StyleSheet, Text, View } from 'react-native';

import { ThemedTextInput } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { DOCUMENT_FIELDS, type FieldDef } from '@/types/documentFields';
import type { DocumentType } from '@/types';

interface DocumentMetadataFieldsProps {
  scheme: 'light' | 'dark';
  type: DocumentType;
  metadata: Record<string, string>;
  editable?: boolean;
  onChange: (key: string, value: string) => void;
}

export function DocumentMetadataFields({
  scheme,
  type,
  metadata,
  editable = true,
  onChange,
}: DocumentMetadataFieldsProps) {
  const C = Colors[scheme];
  const fields = DOCUMENT_FIELDS[type] ?? [];
  if (fields.length === 0) return null;

  return (
    <>
      {fields.map((field: FieldDef) => (
        <View key={field.key}>
          <Text style={[styles.label, { color: C.text }]}>{field.label}</Text>
          <ThemedTextInput
            style={styles.input}
            placeholder={field.placeholder ?? ''}
            value={metadata[field.key] ?? ''}
            onChangeText={v => onChange(field.key, v)}
            keyboardType={field.keyboardType ?? 'default'}
            editable={editable}
          />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, opacity: 0.7, marginTop: 14, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
});
