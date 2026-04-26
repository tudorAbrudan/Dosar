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

// ─── Mention types ─────────────────────────────────────────────────────────────

interface MentionItem {
  id: string;
  name: string;
  entityType: 'person' | 'vehicle' | 'property' | 'card' | 'animal' | 'company';
  icon: string;
  typeLabel: string;
}

const MENTION_TYPE_LABELS: Record<MentionItem['entityType'], string> = {
  person: 'Persoană',
  vehicle: 'Vehicul',
  property: 'Proprietate',
  card: 'Card',
  animal: 'Animal',
  company: 'Firmă',
};
const MENTION_ICONS: Record<MentionItem['entityType'], string> = {
  person: '👤',
  vehicle: '🚗',
  property: '🏠',
  card: '💳',
  animal: '🐾',
  company: '🏢',
};

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
interface ConversationMessage extends ChatMessage {
  id?: string;
}

// Regex combinat: [ID:docId] | [DOC:label|docId] | [ENT:name|type|id]
const LINK_REGEX = /\[ID:([^\]]+)\]|\[DOC:([^|]+)\|([^\]]+)\]|\[ENT:([^|]+)\|([^|]+)\|([^\]]+)\]/g;

// ─── Mesaj welcome ─────────────────────────────────────────────────────────────

const WELCOME_CONTENT =
  'Bună! Pot răspunde la întrebări despre documentele tale. Ex: «Când expiră buletinul?», «Arată RCA-urile», «Ce documente am pentru Dacia Logan?»';

// ─── Select Text Modal ─────────────────────────────────────────────────────────

interface SelectTextModalProps {
  visible: boolean;
  text: string;
  colors: typeof lightColors;
  onClose: () => void;
}

function SelectTextModal({ visible, text, colors, onClose }: SelectTextModalProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopyAll() {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.selectModalOverlay} onPress={onClose}>
        <Pressable
          style={[styles.selectModalBox, { backgroundColor: colors.surface }]}
          onPress={e => e.stopPropagation()}
        >
          <View style={styles.selectModalHeader}>
            <Text style={[styles.selectModalTitle, { color: colors.text }]}>Selectează text</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text style={[styles.selectModalClose, { color: colors.textSecondary }]}>✕</Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.selectModalInput, { color: colors.text, borderColor: colors.border }]}
            value={text}
            editable={false}
            multiline
            selectTextOnFocus
          />
          <Pressable
            style={[styles.selectModalCopyBtn, { backgroundColor: colors.primary }]}
            onPress={handleCopyAll}
          >
            <Text style={styles.selectModalCopyText}>{copied ? 'Copiat!' : 'Copiază tot'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Message Bubble ────────────────────────────────────────────────────────────

function renderMessageContent(
  content: string,
  onIdPress: (id: string) => void,
  onEntityPress: (id: string) => void,
  linkColor: string,
  textColor: string
): React.ReactNode[] {
  const regex = new RegExp(LINK_REGEX.source, 'g');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before) {
      parts.push(
        <Text key={`t-${lastIndex}`} style={{ color: textColor }}>
          {before}
        </Text>
      );
    }

    if (match[1]) {
      // [ID:docId] — format vechi, afișează tag-ul brut dar clickabil
      const docId = match[1];
      const fullTag = match[0];
      parts.push(
        <Text
          key={`id-${match.index}`}
          style={[styles.idLink, { color: linkColor }]}
          onPress={() => onIdPress(docId)}
        >
          {fullTag}
        </Text>
      );
    } else if (match[2]) {
      // [DOC:label|docId] — afișează label-ul ca link
      const label = match[2];
      const docId = match[3];
      parts.push(
        <Text
          key={`doc-${match.index}`}
          style={[styles.idLink, { color: linkColor }]}
          onPress={() => onIdPress(docId)}
        >
          {label}
        </Text>
      );
    } else {
      // [ENT:name|type|id] — afișează numele entității ca link
      const entName = match[4];
      const entId = match[6];
      parts.push(
        <Text
          key={`ent-${match.index}`}
          style={[styles.idLink, { color: linkColor }]}
          onPress={() => onEntityPress(entId)}
        >
          {entName}
        </Text>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  const remaining = content.slice(lastIndex);
  if (remaining) {
    parts.push(
      <Text key="t-end" style={{ color: textColor }}>
        {remaining}
      </Text>
    );
  }

  return parts;
}

interface MessageBubbleProps {
  message: ConversationMessage;
  onIdPress: (id: string) => void;
  onEntityPress: (id: string) => void;
  onDelete: (msg: ConversationMessage) => void;
  colors: typeof lightColors;
}

function MessageBubble({
  message,
  onIdPress,
  onEntityPress,
  onDelete,
  colors,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [showSelectModal, setShowSelectModal] = useState(false);

  function handleLongPress() {
    if (isUser) {
      Alert.alert('Mesaj', undefined, [
        { text: 'Șterge mesaj', style: 'destructive', onPress: () => onDelete(message) },
        { text: 'Anulează', style: 'cancel' },
      ]);
    } else {
      Alert.alert('Mesaj AI', undefined, [
        { text: 'Copiază tot', onPress: () => setShowSelectModal(true) },
        { text: 'Șterge mesaj', style: 'destructive', onPress: () => onDelete(message) },
        { text: 'Anulează', style: 'cancel' },
      ]);
    }
  }

  if (isUser) {
    return (
      <Pressable onLongPress={handleLongPress} delayLongPress={400}>
        <View style={[styles.bubble, styles.userBubble, { backgroundColor: colors.primary }]}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      </Pressable>
    );
  }

  const nodes = renderMessageContent(
    message.content,
    onIdPress,
    onEntityPress,
    colors.primary,
    colors.text
  );

  return (
    <>
      <Pressable onLongPress={handleLongPress} delayLongPress={400}>
        <View
          style={[
            styles.bubble,
            styles.assistantBubble,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text selectable>{nodes}</Text>
        </View>
      </Pressable>
      <SelectTextModal
        visible={showSelectModal}
        text={message.content}
        colors={colors}
        onClose={() => setShowSelectModal(false)}
      />
    </>
  );
}

// ─── Consent Modal ─────────────────────────────────────────────────────────────

interface ConsentModalProps {
  visible: boolean;
  colors: typeof lightColors;
  onAccept: () => void;
  onDecline: () => void;
}

function ConsentModal({ visible, colors, onAccept, onDecline }: ConsentModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={styles.consentOverlay}>
        <View style={[styles.consentBox, { backgroundColor: colors.surface }]}>
          <ScrollView
            style={styles.consentScroll}
            contentContainerStyle={styles.consentScrollContent}
            showsVerticalScrollIndicator
          >
            <Text style={[styles.consentTitle, { color: colors.text }]}>
              Asistent AI – Informații despre confidențialitate
            </Text>
            <Text style={[styles.consentBody, { color: colors.text }]}>
              Pentru a răspunde la întrebările tale, asistentul trimite date din aplicație
              către{' '}
              <Text style={{ fontWeight: '700' }}>serviciul AI configurat</Text> (cloud extern).
            </Text>
            <Text style={[styles.consentBody, { color: colors.text }]}>
              <Text style={{ fontWeight: '700' }}>Ce date sunt trimise:</Text> numele entităților
              (persoane, vehicule, proprietăți, carduri, animale), tipurile documentelor, datele de
              expirare și emitere, notele atașate documentelor, date de identificare ale documentelor
              (serie acte, CNP, nr. înmatriculare, nr. înregistrare și alte câmpuri completate).
            </Text>
            <Text style={[styles.consentBody, { color: colors.text }]}>
              <Text style={{ fontWeight: '700' }}>Ce NU este trimis:</Text> fotografiile documentelor,
              numărul CVV, PIN-ul aplicației.
            </Text>
            <Text style={[styles.consentNote, { color: colors.textSecondary }]}>
              Datele sunt procesate de providerul AI ales conform propriei politici de confidențialitate.
              Consimțământul poate fi revocat oricând dezactivând providerul din Setări → Asistent AI.
              Dacă nu dorești să partajezi aceste date, apasă „Nu accept".
            </Text>
          </ScrollView>
          <View style={styles.consentButtons}>
            <Pressable
              style={[styles.consentBtn, styles.consentBtnDecline, { borderColor: colors.border }]}
              onPress={onDecline}
            >
              <Text style={[styles.consentBtnText, { color: colors.text }]}>Nu accept</Text>
            </Pressable>
            <Pressable
              style={[
                styles.consentBtn,
                styles.consentBtnAccept,
                { backgroundColor: colors.primary },
              ]}
              onPress={onAccept}
            >
              <Text style={[styles.consentBtnText, { color: '#ffffff' }]}>Accept</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Rename Modal ──────────────────────────────────────────────────────────────

interface RenameModalProps {
  visible: boolean;
  initialName: string;
  colors: typeof lightColors;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

function RenameModal({ visible, initialName, colors, onConfirm, onCancel }: RenameModalProps) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.consentOverlay} onPress={onCancel}>
        <Pressable
          style={[styles.selectModalBox, { backgroundColor: colors.surface }]}
          onPress={e => e.stopPropagation()}
        >
          <Text style={[styles.selectModalTitle, { color: colors.text }]}>
            Redenumește conversația
          </Text>
          <TextInput
            style={[
              styles.renameInput,
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
          <View style={styles.consentButtons}>
            <Pressable
              style={[styles.consentBtn, styles.consentBtnDecline, { borderColor: colors.border }]}
              onPress={onCancel}
            >
              <Text style={[styles.consentBtnText, { color: colors.text }]}>Anulează</Text>
            </Pressable>
            <Pressable
              style={[
                styles.consentBtn,
                styles.consentBtnAccept,
                { backgroundColor: colors.primary },
              ]}
              onPress={() => name.trim() && onConfirm(name.trim())}
            >
              <Text style={[styles.consentBtnText, { color: '#ffffff' }]}>Salvează</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Thread List ───────────────────────────────────────────────────────────────

interface ThreadListProps {
  threads: ChatThread[];
  colors: typeof lightColors;
  insets: { top: number; bottom: number };
  onSelect: (thread: ChatThread) => void;
  onNew: () => void;
  onRename: (thread: ChatThread) => void;
  onDelete: (thread: ChatThread) => void;
  loading: boolean;
}

function ThreadList({
  threads,
  colors,
  insets,
  onSelect,
  onNew,
  onRename,
  onDelete,
  loading,
}: ThreadListProps) {
  function formatTime(iso: string): string {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60_000) return 'acum';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ore`;
    return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
  }

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      {/* Header */}
      <View style={[styles.threadListHeader, { borderBottomColor: colors.border }]}>
        <Text style={[styles.threadListTitle, { color: colors.text }]}>Conversații</Text>
        <Pressable
          style={[styles.newThreadBtn, { backgroundColor: colors.primary }]}
          onPress={onNew}
        >
          <Text style={styles.newThreadBtnText}>+ Nouă</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : threads.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>Nicio conversație</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textSecondary }]}>
            Apasă „+ Nouă" pentru a începe
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.threadScroll}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        >
          {threads.map(thread => (
            <Pressable
              key={thread.id}
              style={({ pressed }) => [
                styles.threadCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => onSelect(thread)}
              onLongPress={() =>
                Alert.alert(thread.name, 'Ce vrei să faci cu această conversație?', [
                  { text: 'Redenumește', onPress: () => onRename(thread) },
                  {
                    text: 'Șterge',
                    style: 'destructive',
                    onPress: () => onDelete(thread),
                  },
                  { text: 'Anulează', style: 'cancel' },
                ])
              }
            >
              <View style={styles.threadCardContent}>
                <View style={styles.threadCardLeft}>
                  <Text style={[styles.threadCardName, { color: colors.text }]} numberOfLines={1}>
                    {thread.name}
                  </Text>
                  {thread.lastMessage && (
                    <Text
                      style={[styles.threadCardPreview, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {thread.lastMessage}
                    </Text>
                  )}
                </View>
                <View style={styles.threadCardRight}>
                  <Text style={[styles.threadCardTime, { color: colors.textSecondary }]}>
                    {formatTime(thread.updated_at)}
                  </Text>
                  <Text style={[styles.threadCardCount, { color: colors.textSecondary }]}>
                    {thread.messageCount} msg
                  </Text>
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

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
              opacity:
                pressed || !input.trim() || aiUnavailableReason ? 0.6 : 1,
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
      setAiUnavailableReason('Nu s-a putut verifica configurația AI. Deschide Setări → Asistent AI.');
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
