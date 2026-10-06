import { ReactNode } from 'react';
import { Modal, ScrollView, KeyboardAvoidingView, StyleSheet } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { SheetHeader } from '@/components/ui/SheetHeader';

type Props = {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
  children: ReactNode;
};

export function FormSheetModal({
  visible,
  title,
  onClose,
  onSave,
  saving = false,
  saveDisabled = false,
  saveLabel = 'Salvează',
  cancelLabel = 'Anulează',
  children,
}: Props) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={saving ? () => {} : onClose}
    >
      {/* iOS: `padding` se măsoară greșit într-un modal `pageSheet` (sheet-ul
          nu pornește din vârful ecranului), deci ultimul câmp rămânea sub
          tastatură. Lăsăm ScrollView-ul să-și ajusteze singur inset-ul la
          tastatură (`automaticallyAdjustKeyboardInsets`) și dezactivăm padding-ul
          KAV pe iOS. Pe Android rămâne adjustResize (windowSoftInputMode). */}
      <KeyboardAvoidingView
        behavior={undefined}
        style={[styles.flex, { backgroundColor: C.background }]}
      >
        <SheetHeader
          title={title}
          onCancel={onClose}
          onSave={onSave}
          cancelLabel={cancelLabel}
          saveLabel={saveLabel}
          saving={saving}
          saveDisabled={saveDisabled}
        />

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 16 },
});
