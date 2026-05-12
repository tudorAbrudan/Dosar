import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, primaryTint, onPrimary } from '@/theme/colors';
import { useMedicalChat, useMedicalChatThreads } from '@/hooks/useMedicalChat';
import { MedicalChatBubble } from '@/components/medical/MedicalChatBubble';
import { MedicalConsentModal } from '@/components/medical/MedicalConsentModal';
import { useMedicalLock } from '@/hooks/useMedicalLock';
import { setAiConsent } from '@/services/medicalRecord';
import { getAiMedicalAllowed, setAiMedicalAllowed } from '@/services/settings';
import { on as subscribe } from '@/services/events';
import { useRouter } from 'expo-router';
import type { MedicalRecord } from '@/types';

interface Props {
  record: MedicalRecord;
}

const SUGGESTIONS = [
  'Care e ultima mea analiză?',
  'Ce vaccinuri am făcut?',
  'Ce medicamente îmi sunt prescrise?',
];

export function ChatTab({ record }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const router = useRouter();
  const lock = useMedicalLock();
  const [showConsent, setShowConsent] = useState(false);

  const {
    threads,
    create: createThread,
    loading: loadingThreads,
  } = useMedicalChatThreads(record.id);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const { messages, sending, send, error } = useMedicalChat(activeThreadId, record.id);
  const [input, setInput] = useState('');
  const [globallyAllowed, setGloballyAllowed] = useState<boolean | null>(null);
  const listRef = useRef<FlatList>(null);

  const refreshGlobalAllowed = useCallback(() => {
    getAiMedicalAllowed().then(setGloballyAllowed);
  }, []);

  useEffect(() => {
    refreshGlobalAllowed();
  }, [refreshGlobalAllowed]);

  useEffect(() => {
    const off = subscribe('settings:changed', refreshGlobalAllowed);
    return () => off();
  }, [refreshGlobalAllowed]);

  // Auto-creează un thread default dacă nu există
  useEffect(() => {
    if (loadingThreads) return;
    if (threads.length === 0) {
      createThread('Conversație').then(t => {
        if (t) setActiveThreadId(t.id);
      });
    } else if (!activeThreadId) {
      setActiveThreadId(threads[0].id);
    }
  }, [threads, loadingThreads, activeThreadId, createThread]);

  // Auto-scroll la mesaj nou
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [messages.length]);

  // Empty state: override global AI medical OFF — prioritar (afectează toate dosarele)
  if (globallyAllowed === false) {
    return (
      <View style={styles.center}>
        <Ionicons name="warning-outline" size={48} color={palette.textSecondary} />
        <Text style={[styles.centerTitle, { color: palette.text }]}>
          AI medical dezactivat global
        </Text>
        <Text style={[styles.centerHint, { color: palette.textSecondary }]}>
          Ai dezactivat asistentul AI pentru date medicale din Setări → Asistent AI. Activează-l de
          acolo pentru a folosi chat-ul.
        </Text>
        <Pressable
          style={[styles.unlockBtn, { backgroundColor: primary }]}
          onPress={() => router.push('/setari/medical-ai')}
        >
          <Text style={[styles.unlockBtnText, { color: onPrimary }]}>Deschide Setări AI</Text>
        </Pressable>
      </View>
    );
  }

  // Empty state: consent missing per dosar — buton direct pentru activare
  if (!record.ai_consent_at) {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={48} color={palette.textSecondary} />
        <Text style={[styles.centerTitle, { color: palette.text }]}>
          Asistent AI dezactivat pentru acest dosar
        </Text>
        <Text style={[styles.centerHint, { color: palette.textSecondary }]}>
          Categoria datelor medicale (GDPR Art. 9) cere consimțământ explicit pe fiecare dosar
          separat. Toggle-ul global din Setări permite AI medical pe app, dar fiecare dosar e
          opt-in distinct.
        </Text>
        <Pressable
          style={[styles.unlockBtn, { backgroundColor: primary }]}
          onPress={() => setShowConsent(true)}
        >
          <Text style={[styles.unlockBtnText, { color: onPrimary }]}>
            Activează AI pentru acest dosar
          </Text>
        </Pressable>
        <MedicalConsentModal
          visible={showConsent}
          onAccept={async () => {
            try {
              // Sigur și global allowed e ON (consent dosar implică folosire activă).
              await setAiMedicalAllowed(true);
              await setAiConsent(record.id);
            } catch {
              /* logged in service */
            }
            setShowConsent(false);
            // record va fi refresh-uit prin event bus
          }}
          onReject={() => setShowConsent(false)}
        />
      </View>
    );
  }

  if (lock.locked) {
    return (
      <View style={styles.center}>
        <Ionicons name="finger-print-outline" size={48} color={palette.textSecondary} />
        <Text style={[styles.centerTitle, { color: palette.text }]}>Deblochează</Text>
        <Text style={[styles.centerHint, { color: palette.textSecondary }]}>
          Acesta este conținut sensibil — confirmă identitatea pentru a continua.
        </Text>
        <Pressable
          style={[styles.unlockBtn, { backgroundColor: primary }]}
          onPress={() => lock.unlockWithBiometric()}
        >
          <Text style={[styles.unlockBtnText, { color: onPrimary }]}>Deblochează cu biometric</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}
    >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        contentContainerStyle={{ paddingVertical: 12 }}
        renderItem={({ item }) => <MedicalChatBubble msg={item} />}
        ListEmptyComponent={
          <View style={styles.emptyChat}>
            <Text style={[styles.suggestTitle, { color: palette.textSecondary }]}>
              Întreabă-mă despre dosarul tău medical:
            </Text>
            {SUGGESTIONS.map(s => (
              <Pressable
                key={s}
                onPress={() => send(s)}
                style={[
                  styles.suggestion,
                  { borderColor: palette.border, backgroundColor: palette.card },
                ]}
              >
                <Text style={{ color: palette.text, fontSize: 14 }}>{s}</Text>
              </Pressable>
            ))}
          </View>
        }
        ListFooterComponent={
          error ? (
            <View style={[styles.errorBanner, { backgroundColor: '#FFEBEE' }]}>
              <Text style={{ color: '#C62828', fontSize: 13 }}>{error}</Text>
            </View>
          ) : null
        }
      />

      <View
        style={[
          styles.inputRow,
          { borderTopColor: palette.border, backgroundColor: palette.surface },
        ]}
      >
        <View
          style={[
            styles.inputWrap,
            { backgroundColor: palette.background, borderColor: palette.border },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Întreabă despre dosarul medical..."
            placeholderTextColor={palette.textSecondary}
            multiline
            editable={!sending}
            style={[styles.input, { color: palette.text }]}
          />
        </View>
        <Pressable
          style={[
            styles.sendBtn,
            {
              backgroundColor: input.trim() && !sending ? primary : palette.border,
            },
          ]}
          disabled={!input.trim() || sending}
          onPress={async () => {
            const q = input.trim();
            if (!q) return;
            setInput('');
            await send(q);
          }}
          accessibilityLabel="Trimite întrebare"
        >
          {sending ? (
            <ActivityIndicator color={onPrimary} size="small" />
          ) : (
            <Ionicons name="arrow-up" size={20} color={onPrimary} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  centerTitle: { fontSize: 17, fontWeight: '600', marginTop: 12 },
  centerHint: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  unlockBtn: {
    marginTop: 18,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  unlockBtnText: { fontSize: 15, fontWeight: '600' },
  emptyChat: { padding: 16, gap: 8 },
  suggestTitle: { fontSize: 13, marginBottom: 4 },
  suggestion: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginVertical: 4,
  },
  inputRow: {
    flexDirection: 'row',
    padding: 10,
    borderTopWidth: 1,
    alignItems: 'flex-end',
    gap: 8,
  },
  inputWrap: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 4,
    maxHeight: 120,
  },
  input: { fontSize: 15, paddingVertical: 8 },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: { padding: 12, margin: 12, borderRadius: 8 },
});
