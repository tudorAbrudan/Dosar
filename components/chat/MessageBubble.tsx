import { useState } from 'react';
import { View, Text, Pressable, Alert, StyleSheet, Linking } from 'react-native';
import type { ChatMessage } from '@/services/chatbot';
import { SelectTextModal } from './SelectTextModal';

export interface ConversationMessage extends ChatMessage {
  id?: string;
}

const LINK_REGEX = /\[ID:([^\]]+)\]|\[DOC:([^|]+)\|([^\]]+)\]|\[ENT:([^|]+)\|([^|]+)\|([^\]]+)\]/g;

export interface MessageBubbleColors {
  surface: string;
  border: string;
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

/**
 * Segmentele de text simplu dintre tag-uri, cu `**bold**` randat ca atare.
 *
 * Modelele scriu markdown din obișnuință („născută pe **1 februarie 2020**") și
 * până acum asteriscurile ajungeau literal pe ecran — parser-ul cunoștea doar
 * tag-urile [ID:]/[DOC:]/[ENT:]. Afecta orice provider, inclusiv cloud.
 * Raportat 2026-09-03.
 *
 * Deliberat minimal: doar bold. Restul markdown-ului (liste, titluri, cod) nu
 * apare în răspunsurile aplicației și n-ar merita un parser complet.
 */
function renderPlainText(text: string, keyPrefix: string, textColor: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // URL-uri → link-uri apăsabile. Mesajele de limită AI conțin linkul către
  // ghidul „cum îți iei cheie proprie"; ca text simplu, userul ar trebui să-l
  // copieze de mână. Se aplică înainte de bold, ca să nu spargem tag-urile.
  const urlRegex = /(https?:\/\/[^\s)]+)/g;
  const withLinks = (chunk: string, keyBase: string): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    urlRegex.lastIndex = 0;
    while ((m = urlRegex.exec(chunk)) !== null) {
      if (m.index > last) out.push(chunk.slice(last, m.index));
      const url = m[1];
      out.push(
        <Text
          key={`${keyBase}-u-${m.index}`}
          style={styles.link}
          onPress={() => {
            void Linking.openURL(url).catch(() => undefined);
          }}
        >
          {url}
        </Text>
      );
      last = m.index + m[0].length;
    }
    if (last < chunk.length) out.push(chunk.slice(last));
    return out;
  };
  // Bullet-uri markdown la început de linie („* text" / „- text") → „• text".
  // Modelele le emit din obișnuință; fără conversie, asteriscul apărea literal
  // în listă („*   Vehiculul Dacia Duster are..."). Observat pe device 2026-09-04.
  text = text.replace(/^[ \t]*[*-][ \t]+/gm, '• ');
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRegex.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(
        <Text key={`${keyPrefix}-p-${last}`} style={{ color: textColor }}>
          {withLinks(text.slice(last, m.index), `${keyPrefix}-${last}`)}
        </Text>
      );
    }
    nodes.push(
      <Text key={`${keyPrefix}-b-${m.index}`} style={[styles.bold, { color: textColor }]}>
        {m[1]}
      </Text>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    nodes.push(
      <Text key={`${keyPrefix}-p-${last}`} style={{ color: textColor }}>
        {withLinks(text.slice(last), `${keyPrefix}-${last}`)}
      </Text>
    );
  }
  return nodes;
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
      parts.push(...renderPlainText(before, `t-${lastIndex}`, textColor));
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
    parts.push(...renderPlainText(remaining, 't-end', textColor));
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
        {
          text: 'Copiază tot',
          // iOS: defer ca să lase Alert-ul să-și termine animația de dismiss
          // înainte să prezentăm Modal-ul (altfel UIKit refuză present-on-presenting).
          onPress: () => {
            setTimeout(() => setShowSelectModal(true), 350);
          },
        },
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
  bold: { fontWeight: '700' },
  link: { textDecorationLine: 'underline' },
});
