import { useState } from 'react';
import { Modal, View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';

export interface SelectTextModalColors {
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  primary: string;
}

interface SelectTextModalProps {
  visible: boolean;
  text: string;
  colors: SelectTextModalColors;
  onClose: () => void;
}

/**
 * Modal pentru selectarea/copierea unui mesaj din chat. Folosit pe long-press.
 */
export function SelectTextModal({ visible, text, colors, onClose }: SelectTextModalProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopyAll() {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[styles.box, { backgroundColor: colors.surface }]}
          onPress={e => e.stopPropagation()}
        >
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Selectează text</Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Închide">
              <Text style={[styles.close, { color: colors.textSecondary }]}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.input, { color: colors.text, borderColor: colors.border }]}
            value={text}
            editable={false}
            multiline
            selectTextOnFocus
          />
          <Pressable
            style={[styles.copyBtn, { backgroundColor: colors.primary }]}
            onPress={handleCopyAll}
          >
            <Text style={styles.copyText}>{copied ? 'Copiat!' : 'Copiază tot'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: { borderRadius: 16, padding: 16, width: '100%', maxWidth: 420, gap: 12 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 16, fontWeight: '600' },
  close: { fontSize: 16, paddingHorizontal: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    maxHeight: 320,
    textAlignVertical: 'top',
  },
  copyBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  copyText: { color: '#ffffff', fontWeight: '600', fontSize: 15 },
});
