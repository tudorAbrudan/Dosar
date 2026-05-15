import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useColorScheme } from '@/components/useColorScheme';
import { light as lightColors, dark as darkColors } from '@/theme/colors';
import { sendMessage, type ChatMessage } from '@/services/chatbot';
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
import { SelectTextModal } from '@/components/chat/SelectTextModal';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ConsentModal } from '@/components/chat/ConsentModal';
import { RenameModal } from '@/components/chat/RenameModal';
import { ThreadList } from '@/components/chat/ThreadList';
import { ENTITY_TYPE_LABELS, ENTITY_TYPE_EMOJI } from '@/types';
import type { EntityType } from '@/types';

// ─── Mention types ─────────────────────────────────────────────────────────────

interface MentionItem {
  id: string;
  name: string;
  entityType: EntityType;
  icon: string;
  typeLabel: string;
}

// Mapping-urile sunt în types/index.ts — sursa unică.
const MENTION_TYPE_LABELS = ENTITY_TYPE_LABELS;
const MENTION_ICONS = ENTITY_TYPE_EMOJI;

/** Detectează un @query activ la finalul textului (după ultimul @ precedat de spațiu sau start). */
function detectMentionQuery(text: string): { query: string; atIndex: number } | null {
  const atIndex = text.lastIndexOf('@');
  if (atIndex === -1) return null;
  if (atIndex > 0 && !/[\s\n]/.test(text[atIndex - 1])) return null;
  const afterAt = text.slice(atIndex + 1);
  if (/[\s\n]/.test(afterAt)) return null; // mention already completed
  return { query: afterAt, atIndex };
}

// Mesaj din conversație (ChatMessage + id opțional din DB)
// Re-export pentru codul rămas în acest fișier (legacy — va deveni unused când
// ConversationView se va extrage și ea într-un fișier separat).
import type { ConversationMessage } from '@/components/chat/MessageBubble';
export type { ConversationMessage };

// Regex combinat: [ID:docId] | [DOC:label|docId] | [ENT:name|type|id]
const LINK_REGEX = /\[ID:([^\]]+)\]|\[DOC:([^|]+)\|([^\]]+)\]|\[ENT:([^|]+)\|([^|]+)\|([^\]]+)\]/g;

// ─── Mesaj welcome ─────────────────────────────────────────────────────────────

const WELCOME_CONTENT =
  'Bună! Pot răspunde la întrebări despre documentele tale. Ex: «Când expiră buletinul?», «Arată RCA-urile», «Ce documente am pentru Dacia Logan?»';



// ─── Consent Modal ─────────────────────────────────────────────────────────────


// ─── Rename Modal ──────────────────────────────────────────────────────────────



// ─── Conversation View ─────────────────────────────────────────────────────────

interface ConversationViewProps {
  thread: ChatThread;
  messages: ConversationMessage[];
  loading: boolean;
  colors: typeof lightColors;
  insets: { top: number; bottom: number };
  mentionItems: MentionItem[];
  aiUnavailableReason: string | null;
  onBack: () => void;
  onRename: () => void;
  onClear: () => void;
  onDelete: () => void;
  onDeleteMessage: (msg: ConversationMessage) => void;
  onSend: (displayText: string, aiText: string) => void;
  onOpenSettings: () => void;
}

function ConversationView({
  thread,
  messages,
  loading,
  colors,
  insets,
  mentionItems,
  aiUnavailableReason,
  onBack,
  onRename,
  onClear,
  onDelete,
  onDeleteMessage,
  onSend,
  onOpenSettings,
}: ConversationViewProps) {
  const [input, setInput] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAtIndex, setMentionAtIndex] = useState(0);
  const [resolvedMentions, setResolvedMentions] = useState<Map<string, MentionItem>>(new Map());
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();

  // Filter mention suggestions based on current query
  const mentionSuggestions =
    mentionQuery !== null
      ? mentionItems
          .filter(
            item =>
              mentionQuery.length === 0 ||
              item.name.toLowerCase().includes(mentionQuery.toLowerCase())
          )
          .slice(0, 6)
      : [];

  function handleInputChange(text: string) {
    setInput(text);
    const detected = detectMentionQuery(text);
    if (detected) {
      setMentionQuery(detected.query);
      setMentionAtIndex(detected.atIndex);
    } else {
      setMentionQuery(null);
    }
  }

  function handleMentionSelect(item: MentionItem) {
    const before = input.slice(0, mentionAtIndex);
    const newInput = `${before}@${item.name} `;
    setInput(newInput);
    setMentionQuery(null);
    setResolvedMentions(prev => new Map(prev).set(item.name, item));
  }

  function handleSend() {
    const displayText = input.trim();
    if (!displayText || loading) return;

    // Build AI text: prepend mention context for entities referenced in this message
    const mentioned = Array.from(resolvedMentions.values()).filter(m =>
      displayText.includes(`@${m.name}`)
    );
    const aiText =
      mentioned.length > 0
        ? `[Context mențiuni: ${mentioned.map(m => `@${m.name} = ${m.typeLabel} (ID: ${m.id})`).join(', ')}]\n${displayText}`
        : displayText;

    setInput('');
    setMentionQuery(null);
    setResolvedMentions(new Map());
    onSend(displayText, aiText);
  }

  function handleIdPress(id: string) {
    router.push(`/(tabs)/documente/${id}`);
  }

  function handleEntityPress(id: string) {
    router.push(`/(tabs)/entitati/${id}`);
  }

  function handleMenuPress() {
    Alert.alert(thread.name, 'Opțiuni conversație', [
      { text: 'Redenumește', onPress: onRename },
      { text: 'Șterge tot istoricul', onPress: onClear },
      { text: 'Șterge conversația', style: 'destructive', onPress: onDelete },
      { text: 'Anulează', style: 'cancel' },
    ]);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View
        style={[
          styles.convHeader,
          {
            borderBottomColor: colors.border,
            backgroundColor: colors.surface,
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <Pressable onPress={onBack} hitSlop={8} style={styles.backBtn}>
          <Text style={[styles.backBtnText, { color: colors.primary }]}>← Înapoi</Text>
        </Pressable>
        <Text style={[styles.convHeaderTitle, { color: colors.text }]} numberOfLines={1}>
          {thread.name}
        </Text>
        <Pressable onPress={handleMenuPress} hitSlop={8} style={styles.menuBtn}>
          <Text style={[styles.menuBtnText, { color: colors.primary }]}>···</Text>
        </Pressable>
      </View>

      {/* Banner AI indisponibil */}
      {aiUnavailableReason && (
        <Pressable
          style={[styles.aiBanner, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={onOpenSettings}
        >
          <Text style={styles.aiBannerIcon}>⚠️</Text>
          <View style={styles.aiBannerTextWrap}>
            <Text style={[styles.aiBannerTitle, { color: colors.text }]}>
              Asistentul AI nu este disponibil
            </Text>
            <Text style={[styles.aiBannerBody, { color: colors.textSecondary }]}>
              {aiUnavailableReason}
            </Text>
            <Text style={[styles.aiBannerCta, { color: colors.primary }]}>
              Apasă pentru Setări →
            </Text>
          </View>
        </Pressable>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.map((msg, index) => (
          <MessageBubble
            key={index}
            message={msg}
            onIdPress={handleIdPress}
            onEntityPress={handleEntityPress}
            onDelete={onDeleteMessage}
            colors={colors}
          />
        ))}
        {loading && (
          <View
            style={[
              styles.bubble,
              styles.assistantBubble,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
      </ScrollView>

      {/* Mention suggestions panel */}
      {mentionQuery !== null && mentionSuggestions.length > 0 && (
        <View
          style={[
            styles.mentionPanel,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <ScrollView
            style={styles.mentionScroll}
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
          >
            {mentionSuggestions.map((item, idx) => (
              <Pressable
                key={item.id}
                style={({ pressed }) => [
                  styles.mentionRow,
                  idx < mentionSuggestions.length - 1 && {
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                  },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={() => handleMentionSelect(item)}
              >
                <Text style={styles.mentionIcon}>{item.icon}</Text>
                <View style={styles.mentionTextWrap}>
                  <Text style={[styles.mentionName, { color: colors.text }]}>{item.name}</Text>
                  <Text style={[styles.mentionType, { color: colors.textSecondary }]}>
                    {item.typeLabel}
                  </Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Input */}
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            paddingBottom: 12,
          },
        ]}
      >
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.background,
              color: colors.text,
              borderColor: colors.border,
            },
          ]}
          placeholder={
            aiUnavailableReason
              ? 'AI indisponibil. Verifică Setări.'
              : 'Scrie un mesaj... (@ pentru entități)'
          }
          placeholderTextColor={colors.textSecondary}
          value={input}
          onChangeText={handleInputChange}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          editable={!loading && !aiUnavailableReason}
          multiline
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: colors.primary,
              opacity: pressed || !input.trim() || aiUnavailableReason ? 0.6 : 1,
            },
          ]}
          onPress={handleSend}
          disabled={loading || !input.trim() || !!aiUnavailableReason}
        >
          <Text style={styles.sendButtonText}>Trimite</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

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
      setMessages(prev => [...prev, { role: 'assistant', content: errContent }]);
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
        colors={colors}
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

  // Thread list
  threadListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  threadListTitle: { fontSize: 22, fontWeight: '700' },
  newThreadBtn: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  newThreadBtnText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
  threadScroll: { flex: 1 },
  threadCard: {
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
      },
      android: { elevation: 1 },
    }),
  },
  threadCardContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  threadCardLeft: { flex: 1 },
  threadCardName: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  threadCardPreview: { fontSize: 13, lineHeight: 18 },
  threadCardRight: { alignItems: 'flex-end', gap: 4 },
  threadCardTime: { fontSize: 12 },
  threadCardCount: { fontSize: 11 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptySubtitle: { fontSize: 14 },

  // Conversation
  convHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backBtn: { minWidth: 60 },
  backBtnText: { fontSize: 15, fontWeight: '600' },
  convHeaderTitle: { flex: 1, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  menuBtn: { minWidth: 40, alignItems: 'flex-end' },
  menuBtnText: { fontSize: 20, fontWeight: '700', letterSpacing: 1 },

  // AI unavailable banner
  aiBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  aiBannerIcon: { fontSize: 20, lineHeight: 22 },
  aiBannerTextWrap: { flex: 1, gap: 2 },
  aiBannerTitle: { fontSize: 14, fontWeight: '700' },
  aiBannerBody: { fontSize: 13, lineHeight: 18 },
  aiBannerCta: { fontSize: 13, fontWeight: '600', marginTop: 4 },

  // Messages
  messageList: { flex: 1 },
  messageListContent: { padding: 16, paddingBottom: 8 },
  bubble: { borderRadius: 16, padding: 12, maxWidth: '80%', marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end' },
  assistantBubble: { alignSelf: 'flex-start', borderWidth: 1 },
  userText: { color: '#ffffff', fontSize: 15, lineHeight: 21 },
  idLink: { textDecorationLine: 'underline', fontWeight: '600' },

  // Input
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  textInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonText: { color: '#ffffff', fontWeight: '600', fontSize: 15 },

  // Mention panel
  mentionPanel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: 200,
  },
  mentionScroll: { flexGrow: 0 },
  mentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  mentionIcon: { fontSize: 18, width: 26, textAlign: 'center' },
  mentionTextWrap: { flex: 1 },
  mentionName: { fontSize: 14, fontWeight: '600' },
  mentionType: { fontSize: 12, marginTop: 1 },

  // Select text modal
  selectModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  selectModalBox: { borderRadius: 16, padding: 16, width: '100%', maxWidth: 420, gap: 12 },
  selectModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  selectModalTitle: { fontSize: 16, fontWeight: '600' },
  selectModalClose: { fontSize: 16, paddingHorizontal: 4 },
  selectModalInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    maxHeight: 320,
    textAlignVertical: 'top',
  },
  selectModalCopyBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  selectModalCopyText: { color: '#ffffff', fontWeight: '600', fontSize: 15 },

  // Consent modal
  consentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  consentBox: {
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    gap: 12,
  },
  consentScroll: { flex: 1 },
  consentScrollContent: { gap: 12, paddingBottom: 4 },
  consentTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  consentBody: { fontSize: 14, lineHeight: 21 },
  consentNote: { fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  consentButtons: { flexDirection: 'row', gap: 12, marginTop: 8, flexShrink: 0 },
  consentBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  consentBtnDecline: { borderWidth: 1 },
  consentBtnAccept: {},
  consentBtnText: { fontSize: 15, fontWeight: '600' },

  // Rename modal
  renameInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
});
