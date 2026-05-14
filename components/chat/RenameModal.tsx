import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, TextInput, StyleSheet } from 'react-native';

export interface RenameModalColors {
  surface: string;
  background: string;
  text: string;
  border: string;
  primary: string;
}

interface RenameModalProps {
  visible: boolean;
  initialName: string;
  colors: RenameModalColors;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

/**
 * Modal pentru redenumirea unei conversații din chat.
 */
export function RenameModal({
  visible,
  initialName,
  colors,
  onConfirm,
  onCancel,
}: RenameModalProps) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable
          style={[styles.box, { backgroundColor: colors.surface }]}
          onPress={e => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.text }]}>Redenumește conversația</Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
            value={name}
            onChangeText={setName}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => name.trim() && onConfirm(name.trim())}
          />
          <View style={styles.buttons}>
            <Pressable
              style={[styles.btn, styles.btnDecline, { borderColor: colors.border }]}
              onPress={onCancel}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Anulează</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={() => name.trim() && onConfirm(name.trim())}
            >
              <Text style={[styles.btnText, { color: '#ffffff' }]}>Salvează</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: { borderRadius: 16, padding: 16, width: '100%', maxWidth: 420, gap: 12 },
  title: { fontSize: 16, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnDecline: { borderWidth: 1 },
  btnText: { fontSize: 15, fontWeight: '600' },
});
