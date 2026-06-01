import { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, onPrimary } from '@/theme/colors';

const CONSENT_TEXT = `Pentru a folosi asistentul AI și extragerea automată a datelor din documente, trimitem aceste date la furnizorul AI configurat (Mistral, OpenAI sau cel ales de tine):

• Textul OCR al documentelor medicale
• Întrebările tale și răspunsurile asistentului
• Valori extrase (nume analiză, valori, date) pentru îmbunătățirea contextului

NU trimitem:
• Imaginile sau PDF-urile originale
• Notițele tale private (private_notes)
• Date personale ale altor membri ai dosarelor medicale

Datele rămân criptate pe device. Trimiterea la AI se face HTTPS direct de pe device la furnizorul ales — fără server intermediar.

Conform GDPR (Art. 9), datele medicale sunt o categorie specială. Activarea acestui asistent constituie consimțământ explicit.

Poți retrage consimțământul oricând din Setări → Asistent AI → Date medicale. Dezactivarea închide chat-ul și oprește extracția automată, dar păstrează datele deja extrase (le poți șterge separat).`;

interface BodyProps {
  /** Callback când userul bifează/debifează — folosit de containerul exterior
   *  să activeze/dezactiveze butonul „Activează". */
  onCanAcceptChange?: (canAccept: boolean) => void;
  /**
   * Reset trigger — când valoarea se schimbă, checkboxurile se resetează. Pentru
   * a forța re-citire conștientă la fiecare deschidere a containerului.
   */
  resetKey?: unknown;
  /**
   * Layout: în modalul standalone (ChatTab) textul e într-un ScrollView cu
   * maxHeight 360. Inline în FormSheetModal (CreateMedicalRecordModal) NU vrem
   * scroll intern — exteriorul scroll-uiește.
   */
  scrollable?: boolean;
}

/**
 * Conținutul GDPR pentru consimțământ AI medical — fără wrapper Modal.
 * Folosit fie standalone în `MedicalConsentModal` (ChatTab), fie inline într-un
 * alt container (FormSheetModal în CreateMedicalRecordModal). Decuplarea
 * Modal-ului previne stacking-ul a două `<Modal>` simultane pe iOS.
 */
export function MedicalConsentBody({
  onCanAcceptChange,
  resetKey,
  scrollable = true,
}: BodyProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const [c1, setC1] = useState(false);
  const [c2, setC2] = useState(false);

  useEffect(() => {
    setC1(false);
    setC2(false);
  }, [resetKey]);

  useEffect(() => {
    onCanAcceptChange?.(c1 && c2);
  }, [c1, c2, onCanAcceptChange]);

  const BodyText = (
    <Text style={[styles.body, { color: palette.text }]}>{CONSENT_TEXT}</Text>
  );

  return (
    <View>
      <Text style={[styles.title, { color: palette.text }]}>
        Asistent AI pentru Dosarul medical
      </Text>
      {scrollable ? (
        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          {BodyText}
        </ScrollView>
      ) : (
        BodyText
      )}

      <Pressable
        style={styles.checkRow}
        onPress={() => setC1(v => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: c1 }}
      >
        <View
          style={[
            styles.check,
            {
              borderColor: c1 ? primary : palette.border,
              backgroundColor: c1 ? primary : 'transparent',
            },
          ]}
        >
          {c1 ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
        <Text style={[styles.checkLabel, { color: palette.text }]}>Am citit și am înțeles</Text>
      </Pressable>

      <Pressable
        style={styles.checkRow}
        onPress={() => setC2(v => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: c2 }}
      >
        <View
          style={[
            styles.check,
            {
              borderColor: c2 ? primary : palette.border,
              backgroundColor: c2 ? primary : 'transparent',
            },
          ]}
        >
          {c2 ? <Text style={styles.checkMark}>✓</Text> : null}
        </View>
        <Text style={[styles.checkLabel, { color: palette.text }]}>
          Sunt de acord cu prelucrarea datelor medicale prin asistentul AI
        </Text>
      </Pressable>
    </View>
  );
}

interface Props {
  visible: boolean;
  onAccept(): void;
  onReject(): void;
}

export function MedicalConsentModal({ visible, onAccept, onReject }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const [canAccept, setCanAccept] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onReject}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: palette.card }]}>
          <MedicalConsentBody
            onCanAcceptChange={setCanAccept}
            resetKey={visible}
            scrollable
          />

          <View style={styles.buttons}>
            <Pressable style={[styles.btn, { borderColor: palette.border }]} onPress={onReject}>
              <Text style={[styles.btnText, { color: palette.text }]}>Refuz</Text>
            </Pressable>
            <Pressable
              style={[
                styles.btn,
                styles.btnPrimary,
                { backgroundColor: canAccept ? primary : palette.border },
              ]}
              disabled={!canAccept}
              onPress={onAccept}
            >
              <Text
                style={[
                  styles.btnText,
                  { color: canAccept ? onPrimary : palette.textSecondary, fontWeight: '600' },
                ]}
              >
                Activează asistent
              </Text>
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    borderRadius: 16,
    padding: 20,
    maxHeight: '92%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 4 },
      },
      android: { elevation: 6 },
    }),
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  scroll: { maxHeight: 360, marginBottom: 12 },
  body: { fontSize: 14, lineHeight: 21 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', marginVertical: 8 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkMark: { color: onPrimary, fontSize: 14, fontWeight: '700', lineHeight: 14 },
  checkLabel: { flex: 1, fontSize: 14, lineHeight: 20 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 18 },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: { borderWidth: 0 },
  btnText: { fontSize: 15 },
});
