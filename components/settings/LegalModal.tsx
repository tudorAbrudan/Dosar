import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';

export interface LegalModalProps {
  visible: boolean;
  title: string;
  content: string;
  onClose: () => void;
  scheme: 'light' | 'dark';
}

/**
 * Modal fullscreen (pageSheet) cu text legal scrollabil — folosit pentru
 * Termeni & Condiții și Politica de confidențialitate din Setări.
 */
export function LegalModal({ visible, title, content, onClose, scheme }: LegalModalProps) {
  const C = Colors[scheme];
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { backgroundColor: C.background }]}>
        <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
          <Text style={[styles.title, { color: C.text }]}>{title}</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.close}
            accessibilityLabel="Închide"
          >
            <Ionicons name="close" size={22} color={C.textSecondary} />
          </Pressable>
        </View>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.text, { color: C.text }]}>{content}</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '700', flex: 1 },
  close: { padding: 4 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  text: { fontSize: 14, lineHeight: 22 },
});
