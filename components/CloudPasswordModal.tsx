import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { dark, light, onPrimary, primary, statusColors } from '@/theme/colors';

export type CloudPasswordModalMode = 'setup' | 'unlock';

interface Props {
  visible: boolean;
  mode: CloudPasswordModalMode;
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
}

const TITLES: Record<CloudPasswordModalMode, string> = {
  setup: 'Setează parola de criptare',
  unlock: 'Introdu parola de criptare',
};

const SUBTITLES: Record<CloudPasswordModalMode, string> = {
  setup:
    'Backup-ul iCloud va fi criptat cu această parolă. Doar tu o poți decripta — dacă o uiți, datele sunt pierdute.',
  unlock:
    'Backup-ul tău iCloud este criptat. Introdu parola pentru a continua sincronizarea sau restaurarea.',
};

const SUBMIT_LABELS: Record<CloudPasswordModalMode, string> = {
  setup: 'Activează criptarea',
  unlock: 'Deblochează',
};

/**
 * Modal pentru setarea sau introducerea parolei de criptare a backup-ului iCloud.
 *
 * `onSubmit` este awaited; dacă aruncă, modalul afișează mesajul de eroare și
 * rămâne deschis — apelantul nu trebuie să surface eroarea.
 *
 * State-ul intern (parolă, confirmare, agreed, eroare) e resetat când `visible`
 * trece din `true` în `false` (modal închis).
 */
export function CloudPasswordModal({ visible, mode, onSubmit, onCancel }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset la închidere — pe redeschidere câmpurile sunt curate.
  useEffect(() => {
    if (!visible) {
      setPw('');
      setConfirm('');
      setAgreed(false);
      setErr(null);
      setBusy(false);
    }
  }, [visible]);

  const submit = async () => {
    setErr(null);
    if (mode === 'setup') {
      if (pw.length < 6) {
        setErr('Parola trebuie să aibă cel puțin 6 caractere.');
        return;
      }
      if (pw !== confirm) {
        setErr('Parolele nu coincid.');
        return;
      }
      if (!agreed) {
        setErr('Confirmă că ai înțeles că parola nu poate fi recuperată.');
        return;
      }
    } else {
      if (!pw) {
        setErr('Introdu parola.');
        return;
      }
    }

    setBusy(true);
    try {
      await onSubmit(pw);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (!busy) onCancel();
      }}
    >
      <View style={[styles.backdrop, { backgroundColor: `${palette.text}80` }]}>
        <View style={[styles.card, { backgroundColor: palette.card }]}>
          <Text style={[styles.title, { color: palette.text }]}>{TITLES[mode]}</Text>
          <Text style={[styles.subtitle, { color: palette.textSecondary }]}>{SUBTITLES[mode]}</Text>

          <TextInput
            value={pw}
            onChangeText={setPw}
            placeholder="Parolă"
            placeholderTextColor={palette.textSecondary}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={[
              styles.input,
              {
                color: palette.text,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              },
            ]}
          />

          {mode === 'setup' && (
            <>
              <TextInput
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Confirmă parola"
                placeholderTextColor={palette.textSecondary}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                style={[
                  styles.input,
                  {
                    color: palette.text,
                    borderColor: palette.border,
                    backgroundColor: palette.surface,
                  },
                ]}
              />

              <Pressable
                onPress={() => setAgreed(v => !v)}
                disabled={busy}
                style={({ pressed }) => [styles.agreeRow, pressed && { opacity: 0.7 }]}
                hitSlop={4}
              >
                <View
                  style={[
                    styles.checkbox,
                    {
                      borderColor: agreed ? primary : palette.border,
                      backgroundColor: agreed ? primary : 'transparent',
                    },
                  ]}
                >
                  {agreed ? <Text style={[styles.checkmark, { color: onPrimary }]}>✓</Text> : null}
                </View>
                <Text style={[styles.agreeLabel, { color: palette.text }]}>
                  Înțeleg că dacă uit parola, datele criptate sunt pierdute definitiv.
                </Text>
              </Pressable>
            </>
          )}

          {err ? <Text style={[styles.error, { color: statusColors.critical }]}>{err}</Text> : null}

          <View style={styles.btnRow}>
            <Pressable
              onPress={() => {
                if (!busy) onCancel();
              }}
              disabled={busy}
              style={({ pressed }) => [
                styles.btnOutline,
                { borderColor: palette.border },
                (pressed || busy) && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.btnOutlineText, { color: palette.text }]}>Anulează</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={busy}
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: primary },
                (pressed || busy) && { opacity: 0.6 },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={onPrimary} />
              ) : (
                <Text style={[styles.btnText, { color: onPrimary }]}>{SUBMIT_LABELS[mode]}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 16,
    padding: 20,
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 13, lineHeight: 18, marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 10,
  },
  agreeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
    marginBottom: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkmark: { fontSize: 14, fontWeight: '700', lineHeight: 16 },
  agreeLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
  error: { fontSize: 13, marginTop: 8, marginBottom: 4 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 15, fontWeight: '600' },
  btnOutline: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutlineText: { fontSize: 15, fontWeight: '500' },
});
