import { useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet } from 'react-native';
import type { ChatMessage } from '@/services/chatbot';
import { SelectTextModal, type SelectTextModalColors } from './SelectTextModal';

export interface ConversationMessage extends ChatMessage {
  id?: string;
}

const LINK_REGEX = /\[ID:([^\]]+)\]|\[DOC:([^|]+)\|([^\]]+)\]|\[ENT:([^|]+)\|([^|]+)\|([^\]]+)\]/g;

export interface MessageBubbleColors extends SelectTextModalColors {
  primary: string;
  text: string;
}

interface MessageBubbleProps {
  message: ConversationMessage;
  onIdPress: (id: string) => void;
  onEntityPress: (id: string) => void;
  onDelete: (msg: ConversationMessage) => void;
  colors: MessageBubbleColors;
}

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
      // [ID:docId] — format vechi, afișează tag-ul brut clickabil
      const docId = match[1];
      parts.push(
        <Text
          key={`id-${match.index}`}
          style={[styles.idLink, { color: linkColor }]}
          onPress={() => onIdPress(docId)}
        >
          {match[0]}
        </Text>
      );
    } else if (match[2]) {
      // [DOC:label|docId]
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
      // [ENT:name|type|id]
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

/**
 * Bula unui mesaj din chat. User: aliniat dreapta cu fundal primary, doar text.
 * AI: aliniat stânga, parsează tag-uri [ID:...], [DOC:...|...], [ENT:...|...|...]
 * ca link-uri clickabile. Long-press deschide modal de copiere / ștergere.
 */
export function MessageBubble({
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

const styles = StyleSheet.create({
  bubble: { borderRadius: 16, padding: 12, maxWidth: '80%', marginBottom: 8 },
  userBubble: { alignSelf: 'flex-end' },
  assistantBubble: { alignSelf: 'flex-start', borderWidth: 1 },
  userText: { color: '#ffffff', fontSize: 15, lineHeight: 21 },
  idLink: { textDecorationLine: 'underline', fontWeight: '600' },
});
