import { useState } from 'react';
import { TextInput, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';
import { FormSheetModal } from '@/components/ui/FormSheetModal';

interface SelectTextModalProps {
  visible: boolean;
  text: string;
  onClose: () => void;
}

/**
 * Modal pentru selectarea/copierea unui mesaj din chat. Folosit pe long-press.
 *
 * Folosește `FormSheetModal` (pageSheet) cu acțiunea „Salvează" redenumită
 * „Copiază tot". Vezi docs/superpowers/specs/2026-05-02-form-uniformity-design.md.
 */
export function SelectTextModal({ visible, text, onClose }: SelectTextModalProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const [copied, setCopied] = useState(false);

  async function handleCopyAll() {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <FormSheetModal
      visible={visible}
      title="Selectează text"
      onClose={onClose}
      onSave={handleCopyAll}
      cancelLabel="Închide"
      saveLabel={copied ? 'Copiat!' : 'Copiază tot'}
    >
      <TextInput
        style={[styles.input, { color: palette.text, borderColor: palette.border }]}
        value={text}
        editable={false}
        multiline
        selectTextOnFocus
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
    lineHeight: 22,
    minHeight: 200,
    textAlignVertical: 'top',
  },
});
