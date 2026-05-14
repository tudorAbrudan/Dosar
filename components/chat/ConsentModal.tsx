import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';

export interface ConsentModalColors {
  surface: string;
  text: string;
  textSecondary: string;
  border: string;
  primary: string;
}

interface ConsentModalProps {
  visible: boolean;
  colors: ConsentModalColors;
  onAccept: () => void;
  onDecline: () => void;
}

/**
 * Modal de consimțământ pentru utilizarea asistentului AI în chat.
 * Listează explicit ce date pleacă la AI (mirror politică confidențialitate).
 */
export function ConsentModal({ visible, colors, onAccept, onDecline }: ConsentModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.overlay}>
        <View style={[styles.box, { backgroundColor: colors.surface }]}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator
          >
            <Text style={[styles.title, { color: colors.text }]}>
              Asistent AI – Informații despre confidențialitate
            </Text>
            <Text style={[styles.body, { color: colors.text }]}>
              Pentru a răspunde la întrebările tale, asistentul trimite date din aplicație către{' '}
              <Text style={styles.bold}>serviciul AI configurat</Text> (cloud extern).
            </Text>
            <Text style={[styles.body, { color: colors.text }]}>
              <Text style={styles.bold}>Ce date sunt trimise:</Text> numele entităților (persoane,
              vehicule, proprietăți, carduri, animale), tipurile documentelor, datele de expirare
              și emitere, notele atașate documentelor, date de identificare ale documentelor (serie
              acte, CNP, nr. înmatriculare, nr. înregistrare și alte câmpuri completate).
            </Text>
            <Text style={[styles.body, { color: colors.text }]}>
              <Text style={styles.bold}>Ce NU este trimis:</Text> fotografiile documentelor,
              numărul CVV, PIN-ul aplicației.
            </Text>
            <Text style={[styles.note, { color: colors.textSecondary }]}>
              Datele sunt procesate de providerul AI ales conform propriei politici de
              confidențialitate. Consimțământul poate fi revocat oricând dezactivând providerul
              din Setări → Asistent AI. Dacă nu dorești să partajezi aceste date, apasă „Nu accept".
            </Text>
          </ScrollView>
          <View style={styles.buttons}>
            <Pressable
              style={[styles.btn, styles.btnDecline, { borderColor: colors.border }]}
              onPress={onDecline}
            >
              <Text style={[styles.btnText, { color: colors.text }]}>Nu accept</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={onAccept}
            >
              <Text style={[styles.btnText, { color: '#ffffff' }]}>Accept</Text>
            </Pressable>
          </View>
        </View>
      </View>
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
  box: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    gap: 12,
  },
  scroll: { flex: 1 },
  scrollContent: { gap: 12, paddingBottom: 4 },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  body: { fontSize: 14, lineHeight: 21 },
  note: { fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  bold: { fontWeight: '700' },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 8, flexShrink: 0 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  btnDecline: { borderWidth: 1 },
  btnText: { fontSize: 15, fontWeight: '600' },
});
