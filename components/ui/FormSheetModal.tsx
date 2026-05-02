import { ReactNode } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';

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
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.flex, { backgroundColor: C.background }]}
      >
        <View style={[styles.header, { borderBottomColor: C.border }]}>
          <Pressable onPress={onClose} disabled={saving} hitSlop={12}>
            <Text style={[styles.action, { color: C.textSecondary }]}>{cancelLabel}</Text>
          </Pressable>
          <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
            {title}
          </Text>
          <Pressable
            onPress={onSave}
            disabled={saving || saveDisabled}
            hitSlop={12}
          >
            <Text
              style={[
                styles.action,
                { color: primary, fontWeight: '600' },
                (saving || saveDisabled) && styles.actionDisabled,
              ]}
            >
              {saving ? 'Salvez...' : saveLabel}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center', marginHorizontal: 8 },
  action: { fontSize: 15 },
  actionDisabled: { opacity: 0.5 },
  content: { padding: 16, gap: 16 },
});
