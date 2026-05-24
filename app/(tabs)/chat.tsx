import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useColorScheme } from '@/components/useColorScheme';
import { light as lightColors, dark as darkColors } from '@/theme/colors';
import { sendMessage } from '@/services/chatbot';
import {
  getPersons,
  getProperties,
  getVehicles,
  getCards,
  getAnimals,
  getCompanies,
} from '@/services/entities';
import {
  getChatThreads,
  createChatThread,
  renameChatThread,
  deleteChatThread,
  getThreadMessages,
  saveMessage,
  deleteMessage,
  clearThreadMessages,
  type ChatThread,
  type StoredMessage,
} from '@/services/chatThreads';
import { AI_CONSENT_KEY, isAiAvailable } from '@/services/aiProvider';
import { ConsentModal } from '@/components/chat/ConsentModal';
import { RenameModal } from '@/components/chat/RenameModal';
import { ThreadList } from '@/components/chat/ThreadList';
import { ConversationView, type MentionItem } from '@/components/chat/ConversationView';
import type { ConversationMessage } from '@/components/chat/MessageBubble';
import { ENTITY_TYPE_LABELS, ENTITY_TYPE_EMOJI } from '@/types';

export type { ConversationMessage };

// Mapping-urile sunt în types/index.ts — sursa unică.
const MENTION_TYPE_LABELS = ENTITY_TYPE_LABELS;
const MENTION_ICONS = ENTITY_TYPE_EMOJI;

const WELCOME_CONTENT =
  'Bună! Pot răspunde la întrebări despre documentele tale. Ex: «Când expiră buletinul?», «Arată RCA-urile», «Ce documente am pentru Dacia Logan?»';





// ─── Screen principal ──────────────────────────────────────────────────────────

export default function ChatScreen() {
  const colorScheme = useColorScheme();
  const colors = colorScheme === 'dark' ? darkColors : lightColors;
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Consent
  const [consentReady, setConsentReady] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [showConsent, setShowConsent] = useState(false);

  // Mentions
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);

  // Threads
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null);

  // Mesaje conversație activă
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sendLoading, setSendLoading] = useState(false);

  // Modals
  const [renameTarget, setRenameTarget] = useState<ChatThread | null>(null);
  const threadInitialized = useRef(false);

  // AI availability (banner)
  const [aiUnavailableReason, setAiUnavailableReason] = useState<string | null>(null);

  const checkAiAvailability = useCallback(async () => {
    try {
      const { ok, reason } = await isAiAvailable();
      setAiUnavailableReason(ok ? null : (reason ?? 'AI indisponibil.'));
    } catch {
      setAiUnavailableReason(
        'Nu s-a putut verifica configurația AI. Deschide Setări → Asistent AI.'
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void checkAiAvailability();
    }, [checkAiAvailability])
  );

  // ── Inițializare ────────────────────────────────────────────────────────────

  useEffect(() => {
    AsyncStorage.getItem(AI_CONSENT_KEY)
      .then(value => {
        if (value === 'true') {
          setConsentAccepted(true);
          setShowConsent(false);
        } else {
          setShowConsent(true);
        }
      })
      .catch(() => setShowConsent(true))
      .finally(() => setConsentReady(true));
  }, []);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const data = await getChatThreads();
      setThreads(data);
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (consentAccepted) {
      void loadThreads();
      void loadMentionItems();
    }
  }, [consentAccepted, loadThreads]);

  // Auto-deschide conversație nouă când nu există niciuna
  useEffect(() => {
    if (consentAccepted && !threadsLoading && !threadInitialized.current) {
      threadInitialized.current = true;
      if (threads.length === 0) {
        void handleNewThread();
      }
    }
  }, [consentAccepted, threadsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMentionItems() {
    const [persons, properties, vehicles, cards, animals, companies] = await Promise.all([
      getPersons(),
      getProperties(),
      getVehicles(),
      getCards(),
      getAnimals(),
      getCompanies(),
    ]);
    const items: MentionItem[] = [
      ...persons.map(p => ({
        id: p.id,
        name: p.name,
        entityType: 'person' as const,
        icon: MENTION_ICONS.person,
        typeLabel: MENTION_TYPE_LABELS.person,
      })),
      ...vehicles.map(v => ({
        id: v.id,
        name: v.name,
        entityType: 'vehicle' as const,
        icon: MENTION_ICONS.vehicle,
        typeLabel: MENTION_TYPE_LABELS.vehicle,
      })),
      ...properties.map(p => ({
        id: p.id,
        name: p.name,
        entityType: 'property' as const,
        icon: MENTION_ICONS.property,
        typeLabel: MENTION_TYPE_LABELS.property,
      })),
      ...cards.map(c => ({
        id: c.id,
        name: c.nickname,
        entityType: 'card' as const,
        icon: MENTION_ICONS.card,
        typeLabel: `${MENTION_TYPE_LABELS.card} ****${c.last4}`,
      })),
      ...animals.map(a => ({
        id: a.id,
        name: a.name,
        entityType: 'animal' as const,
        icon: MENTION_ICONS.animal,
        typeLabel: `${MENTION_TYPE_LABELS.animal} · ${a.species}`,
      })),
      ...companies.map(c => ({
        id: c.id,
        name: c.name,
        entityType: 'company' as const,
        icon: MENTION_ICONS.company,
        typeLabel: MENTION_TYPE_LABELS.company,
      })),
    ];
    setMentionItems(items);
  }

  // ── Deschide conversație ────────────────────────────────────────────────────

  async function openThread(thread: ChatThread) {
    setActiveThread(thread);
    const stored = await getThreadMessages(thread.id);
    if (stored.length === 0) {
      setMessages([{ role: 'assistant', content: WELCOME_CONTENT }]);
    } else {
      setMessages(
        stored.map((m: StoredMessage) => ({ role: m.role, content: m.content, id: m.id }))
      );
    }
  }

  // ── Conversație nouă ────────────────────────────────────────────────────────

  async function handleNewThread() {
    const name = `Conversație ${new Date().toLocaleDateString('ro-RO', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })}`;
    const thread = await createChatThread(name);
    setThreads(prev => [thread, ...prev]);
    await openThread(thread);
  }

  // ── Trimitere mesaj ─────────────────────────────────────────────────────────

  async function handleSend(displayText: string, aiText: string) {
    if (!activeThread) return;

    // Salvăm mai întâi în DB pentru a obține ID-ul
    const savedUser = await saveMessage(activeThread.id, 'user', displayText);
    const userMsg: ConversationMessage = { role: 'user', content: displayText, id: savedUser.id };
    setMessages(prev => [...prev, userMsg]);
    setSendLoading(true);

    // Istoricul pentru AI (fără welcome message)
    const history = messages
      .filter(m => m.content !== WELCOME_CONTENT)
      .concat(userMsg)
      .slice(-20); // limităm la ultimele 20 pentru context

    try {
      const reply = await sendMessage(aiText, history.slice(0, -1));
      const savedAssistant = await saveMessage(activeThread.id, 'assistant', reply);
      const assistantMsg: ConversationMessage = {
        role: 'assistant',
        content: reply,
        id: savedAssistant.id,
      };
      setMessages(prev => [...prev, assistantMsg]);
      // Actualizăm thread-ul local
      setThreads(prev =>
        prev.map(t =>
          t.id === activeThread.id
            ? {
                ...t,
                lastMessage: reply,
                messageCount: t.messageCount + 2,
                updated_at: new Date().toISOString(),
              }
            : t
        )
      );
    } catch (e) {
      const errContent =
        e instanceof Error && e.message
          ? e.message
          : 'A apărut o eroare. Verifică conexiunea la internet și încearcă din nou.';
      // Persistăm și eroarea ca mesaj assistant în DB pentru a păstra alternarea
      // user/assistant. Altfel, la următoarea trimitere, history-ul reîncărcat are
      // două mesaje user consecutive → template-ele LLM stricte (ex. Mistral)
      // resping cu „Conversation roles must alternate".
      try {
        const savedErr = await saveMessage(activeThread.id, 'assistant', errContent);
        setMessages(prev => [...prev, { role: 'assistant', content: errContent, id: savedErr.id }]);
      } catch {
        setMessages(prev => [...prev, { role: 'assistant', content: errContent }]);
      }
    } finally {
      setSendLoading(false);
    }
  }

  // ── Rename ──────────────────────────────────────────────────────────────────

  async function handleRenameConfirm(name: string) {
    if (!renameTarget) return;
    await renameChatThread(renameTarget.id, name);
    const updated = { ...renameTarget, name };
    setThreads(prev => prev.map(t => (t.id === renameTarget.id ? updated : t)));
    if (activeThread?.id === renameTarget.id) setActiveThread(updated);
    setRenameTarget(null);
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  function handleDeleteThread(thread: ChatThread) {
    Alert.alert(
      'Șterge conversația',
      `Ești sigur că vrei să ștergi „${thread.name}" și tot istoricul?`,
      [
        { text: 'Anulează', style: 'cancel' },
        {
          text: 'Șterge',
          style: 'destructive',
          onPress: async () => {
            await deleteChatThread(thread.id);
            setThreads(prev => prev.filter(t => t.id !== thread.id));
            if (activeThread?.id === thread.id) setActiveThread(null);
          },
        },
      ]
    );
  }

  // ── Clear messages ──────────────────────────────────────────────────────────

  function handleClearMessages() {
    if (!activeThread) return;
    Alert.alert('Șterge istoricul', 'Vrei să ștergi toate mesajele din această conversație?', [
      { text: 'Anulează', style: 'cancel' },
      {
        text: 'Șterge',
        style: 'destructive',
        onPress: async () => {
          await clearThreadMessages(activeThread.id);
          setMessages([{ role: 'assistant', content: WELCOME_CONTENT }]);
          setThreads(prev =>
            prev.map(t =>
              t.id === activeThread.id ? { ...t, messageCount: 0, lastMessage: undefined } : t
            )
          );
        },
      },
    ]);
  }

  // ── Ștergere mesaj individual ────────────────────────────────────────────────

  async function handleDeleteMessage(msg: ConversationMessage) {
    setMessages(prev => prev.filter(m => m !== msg));
    if (msg.id) {
      await deleteMessage(msg.id);
      setThreads(prev =>
        prev.map(t =>
          t.id === activeThread?.id ? { ...t, messageCount: Math.max(0, t.messageCount - 1) } : t
        )
      );
    }
  }

  // ── Consent ─────────────────────────────────────────────────────────────────

  function handleAccept() {
    AsyncStorage.setItem(AI_CONSENT_KEY, 'true').catch(() => {});
    setShowConsent(false);
    setConsentAccepted(true);
  }

  function handleDecline() {
    setShowConsent(false);
    router.replace('/(tabs)');
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!consentReady) {
    return (
      <View
        style={[
          styles.container,
          styles.centered,
          { backgroundColor: colors.background, paddingTop: insets.top },
        ]}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
      <ConsentModal
        visible={showConsent}
        colors={colors}
        onAccept={handleAccept}
        onDecline={handleDecline}
      />
      <RenameModal
        visible={renameTarget !== null}
        initialName={renameTarget?.name ?? ''}
        onConfirm={handleRenameConfirm}
        onCancel={() => setRenameTarget(null)}
      />

      {consentAccepted && !activeThread && (
        <ThreadList
          threads={threads}
          colors={colors}
          insets={insets}
          onSelect={openThread}
          onNew={handleNewThread}
          onRename={t => setRenameTarget(t)}
          onDelete={handleDeleteThread}
          loading={threadsLoading}
        />
      )}

      {consentAccepted && activeThread && (
        <ConversationView
          thread={activeThread}
          messages={messages}
          loading={sendLoading}
          colors={colors}
          insets={insets}
          mentionItems={mentionItems}
          aiUnavailableReason={aiUnavailableReason}
          onBack={() => setActiveThread(null)}
          onRename={() => setRenameTarget(activeThread)}
          onClear={handleClearMessages}
          onDelete={() => handleDeleteThread(activeThread)}
          onDeleteMessage={handleDeleteMessage}
          onSend={handleSend}
          onOpenSettings={() => router.push('/(tabs)/setari')}
        />
      )}
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
