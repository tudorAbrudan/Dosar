import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { light as lightColors } from '@/theme/colors';
import type { ChatThread } from '@/services/chatThreads';
import { AiStatusBanner } from './AiStatusBanner';
import type { AiAnswererStatus } from '@/services/aiProvider';
import { MessageBubble } from './MessageBubble';
import type { ConversationMessage } from './MessageBubble';
import type { EntityType } from '@/types';

export interface MentionItem {
  id: string;
  name: string;
  entityType: EntityType;
  icon: string;
  typeLabel: string;
}

/** Detectează un @query activ la finalul textului (după ultimul @ precedat de spațiu sau start). */
export function detectMentionQuery(text: string): { query: string; atIndex: number } | null {
  const atIndex = text.lastIndexOf('@');
  if (atIndex === -1) return null;
  if (atIndex > 0 && !/[\s\n]/.test(text[atIndex - 1])) return null;
  const afterAt = text.slice(atIndex + 1);
  if (/[\s\n]/.test(afterAt)) return null;
  return { query: afterAt, atIndex };
}

interface ConversationViewProps {
  thread: ChatThread;
  messages: ConversationMessage[];
  loading: boolean;
  colors: typeof lightColors;
  insets: { top: number; bottom: number };
  mentionItems: MentionItem[];
  aiStatus: AiAnswererStatus;
  onBack: () => void;
  onRename: () => void;
  onClear: () => void;
  onDelete: () => void;
  onDeleteMessage: (msg: ConversationMessage) => void;
  onSend: (displayText: string, aiText: string) => void;
  onOpenSettings: () => void;
}

export function ConversationView({
  thread,
  messages,
  loading,
  colors,
  insets,
  mentionItems,
  aiStatus,
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
  const scrollRef = useRef<ScrollView>(null);
  const router = useRouter();

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
  }

  function handleSend() {
    const displayText = input.trim();
    if (!displayText || loading) return;

    // Detectăm mențiunile direct din text (nu doar din cele alese din dropdown):
    // userul poate scrie „@Nume" manual, fără să apese sugestia — altfel mesajul
    // pleacă la AI fără ID-ul entității și răspunsul nu poate folosi datele ei.
    const lowerText = displayText.toLowerCase();
    const mentioned = mentionItems.filter(m => lowerText.includes(`@${m.name.toLowerCase()}`));
    const aiText =
      mentioned.length > 0
        ? `[Context mențiuni: ${mentioned.map(m => `@${m.name} = ${m.typeLabel} (ID: ${m.id})`).join(', ')}]\n${displayText}`
        : displayText;

    setInput('');
    setMentionQuery(null);
    onSend(displayText, aiText);
  }

  function handleIdPress(id: string) {
    router.push(`/(tabs)/documente/${id}?from=chat`);
  }

  function handleEntityPress(id: string, entityType: string) {
    // Link-ul spre chat-ul medical (adăugat de chatbot la întrebările medicale)
    // deschide direct tab-ul Chat al dosarului.
    if (entityType === 'medical_record') {
      router.push({ pathname: '/(tabs)/entitati/medical/[id]', params: { id, tab: 'chat' } });
      return;
    }
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

      <AiStatusBanner
        unavailableReason={aiStatus.unavailableReason}
        label={aiStatus.label}
        onDevice={aiStatus.onDevice}
        onOpenSettings={onOpenSettings}
      />

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
            aiStatus.unavailableReason
              ? 'AI indisponibil. Verifică Setări.'
              : 'Scrie un mesaj... (@ pentru entități)'
          }
          placeholderTextColor={colors.textSecondary}
          value={input}
          onChangeText={handleInputChange}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          editable={!loading && !aiStatus.unavailableReason}
          multiline
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            {
              backgroundColor: colors.primary,
              opacity: pressed || !input.trim() || aiStatus.unavailableReason ? 0.6 : 1,
            },
          ]}
          onPress={handleSend}
          disabled={loading || !input.trim() || !!aiStatus.unavailableReason}
        >
          <Text style={styles.sendButtonText}>Trimite</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  convHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  backBtn: { minWidth: 60 },
  backBtnText: { fontSize: 15, fontWeight: '600' },
  convHeaderTitle: { flex: 1, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  menuBtn: { minWidth: 40, alignItems: 'flex-end' },
  menuBtnText: { fontSize: 20, fontWeight: '700', letterSpacing: 1 },

  messageList: { flex: 1 },
  messageListContent: { padding: 16, paddingBottom: 8 },
  bubble: { borderRadius: 16, padding: 12, maxWidth: '80%', marginBottom: 8 },
  assistantBubble: { alignSelf: 'flex-start', borderWidth: 1 },

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
  // Text peste fundal `primary` (verde) — intenționat alb pe ambele teme.
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  sendButtonText: { color: '#ffffff', fontWeight: '600', fontSize: 15 },

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
});
