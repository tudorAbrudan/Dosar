import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import { light as lightColors, dark as darkColors } from '@/theme/colors';
import { sendMessage, type ChatMessage } from '@/services/chatbot';

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content:
    'Bună! Pot răspunde la întrebări despre documentele tale. Ex: «Când expiră buletinul?», «Arată RCA-urile», «Ce documente am pentru Dacia Logan?»',
};

const ID_REGEX = /\[ID:([^\]]+)\]/g;

interface MessageBubbleProps {
  message: ChatMessage;
  onIdPress: (id: string) => void;
  colors: typeof lightColors;
}

function renderMessageContent(
  content: string,
  onIdPress: (id: string) => void,
  linkColor: string,
  textColor: string
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(ID_REGEX.source, 'g');

  while ((match = regex.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before) {
      parts.push(
        <Text key={`text-${lastIndex}`} style={{ color: textColor }}>
          {before}
        </Text>
      );
    }
    const docId = match[1];
    parts.push(
      <Text
        key={`link-${match.index}`}
        style={[styles.idLink, { color: linkColor }]}
        onPress={() => onIdPress(docId)}>
        {match[0]}
      </Text>
    );
    lastIndex = match.index + match[0].length;
  }

  const remaining = content.slice(lastIndex);
  if (remaining) {
    parts.push(
      <Text key={`text-end`} style={{ color: textColor }}>
        {remaining}
      </Text>
    );
  }

  return parts;
}

function MessageBubble({ message, onIdPress, colors }: MessageBubbleProps) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <View style={[styles.bubble, styles.userBubble, { backgroundColor: colors.primary }]}>
        <Text style={styles.userText}>{message.content}</Text>
      </View>
    );
  }

  const nodes = renderMessageContent(message.content, onIdPress, colors.primary, colors.text);

  return (
    <View
      style={[
        styles.bubble,
        styles.assistantBubble,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}>
      <Text>{nodes}</Text>
    </View>
  );
}

export default function ChatScreen() {
  const colorScheme = useColorScheme();
  const colors = colorScheme === 'dark' ? darkColors : lightColors;
  const router = useRouter();

  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const history = messages.filter((m) => m !== WELCOME_MESSAGE);
    const userMsg: ChatMessage = { role: 'user', content: text };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const reply = await sendMessage(text, history);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'A apărut o eroare. Verifică conexiunea la internet și încearcă din nou.',
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  function handleIdPress(id: string) {
    router.push(`/(tabs)/documente/${id}`);
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}>
      <ScrollView
        ref={scrollRef}
        style={styles.messageList}
        contentContainerStyle={styles.messageListContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}>
        {messages.map((msg, index) => (
          <MessageBubble
            key={index}
            message={msg}
            onIdPress={handleIdPress}
            colors={colors}
          />
        ))}
        {loading && (
          <View style={[styles.bubble, styles.assistantBubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        )}
      </ScrollView>

      <View style={[styles.inputRow, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <TextInput
          style={[
            styles.textInput,
            {
              backgroundColor: colors.background,
              color: colors.text,
              borderColor: colors.border,
            },
          ]}
          placeholder="Scrie un mesaj..."
          placeholderTextColor={colors.textSecondary}
          value={input}
          onChangeText={setInput}
          onSubmitEditing={handleSend}
          returnKeyType="send"
          editable={!loading}
          multiline
        />
        <Pressable
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: colors.primary, opacity: pressed || !input.trim() ? 0.6 : 1 },
          ]}
          onPress={handleSend}
          disabled={loading || !input.trim()}>
          <Text style={styles.sendButtonText}>Trimite</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    padding: 16,
    paddingBottom: 8,
  },
  bubble: {
    borderRadius: 16,
    padding: 12,
    maxWidth: '80%',
    marginBottom: 8,
  },
  userBubble: {
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    borderWidth: 1,
  },
  userText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 21,
  },
  idLink: {
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
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
  sendButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 15,
  },
});
