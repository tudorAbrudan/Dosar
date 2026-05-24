import { useEffect, useState } from 'react';
import { TextInput, StyleSheet } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';
import { FormSheetModal } from '@/components/ui/FormSheetModal';

interface RenameModalProps {
  visible: boolean;
  initialName: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/**
 * Modal pentru redenumirea unei conversații din chat.
 *
 * Folosește `FormSheetModal` (pageSheet) — vezi
 * docs/superpowers/specs/2026-05-02-form-uniformity-design.md.
 */
export function RenameModal({ visible, initialName, onConfirm, onCancel }: RenameModalProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  const trimmed = name.trim();

  return (
    <FormSheetModal
      visible={visible}
      title="Redenumește conversația"
      onClose={onCancel}
      onSave={() => trimmed && onConfirm(trimmed)}
      saveDisabled={trimmed.length === 0}
    >
      <TextInput
        style={[
          styles.input,
          {
            color: palette.text,
            borderColor: palette.border,
            backgroundColor: palette.background,
          },
        ]}
        value={name}
        onChangeText={setName}
        autoFocus
        returnKeyType="done"
        placeholder="Nume conversație"
        placeholderTextColor={palette.textSecondary}
        onSubmitEditing={() => trimmed && onConfirm(trimmed)}
      />
    </FormSheetModal>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
});
