import { Fragment } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, primaryTint, onPrimary, onPrimaryMuted } from '@/theme/colors';
import type { MedicalChatMessage } from '@/types';

interface Props {
  msg: MedicalChatMessage;
  recordId: string;
}

const RX_OBS = /\[OBS:([a-z0-9-]+)\]/gi;
const RX_DOC = /\[DOC:([^|\]]+)\|([a-z0-9-]+)\]/gi;

type Part =
  | { type: 'text'; value: string }
  | { type: 'obs'; id: string }
  | { type: 'doc'; id: string; label: string };

function parseContent(text: string): Part[] {
  type M = { idx: number; len: number; kind: 'obs' | 'doc'; id: string; label?: string };
  const matches: M[] = [];
  for (const m of text.matchAll(RX_OBS)) {
    if (m.index != null) matches.push({ idx: m.index, len: m[0].length, kind: 'obs', id: m[1] });
  }
  for (const m of text.matchAll(RX_DOC)) {
    if (m.index != null)
      matches.push({ idx: m.index, len: m[0].length, kind: 'doc', id: m[2], label: m[1] });
  }
  matches.sort((a, b) => a.idx - b.idx);

  const parts: Part[] = [];
  let last = 0;
  for (const m of matches) {
    if (m.idx > last) parts.push({ type: 'text', value: text.slice(last, m.idx) });
    if (m.kind === 'obs') parts.push({ type: 'obs', id: m.id });
    else parts.push({ type: 'doc', id: m.id, label: m.label ?? 'document' });
    last = m.idx + m.len;
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
  return parts;
}

export function MedicalChatBubble({ msg, recordId }: Props) {
  const router = useRouter();
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const isUser = msg.role === 'user';
  const parts = parseContent(msg.content);

  const bubbleBg = isUser ? primary : palette.surface;
  const textColor = isUser ? onPrimary : palette.text;
  const chipBg = isUser ? onPrimaryMuted : primaryTint;
  const chipColor = isUser ? onPrimary : primary;

  return (
    <View style={[styles.row, { justifyContent: isUser ? 'flex-end' : 'flex-start' }]}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: bubbleBg,
            borderColor: isUser ? 'transparent' : palette.border,
          },
        ]}
      >
        <Text style={{ color: textColor, lineHeight: 21 }}>
          {parts.map((p, i) => {
            if (p.type === 'text') {
              return (
                <Text key={i} style={{ color: textColor }}>
                  {p.value}
                </Text>
              );
            }
            if (p.type === 'obs') {
              return (
                <Text
                  key={i}
                  style={{
                    color: chipColor,
                    backgroundColor: chipBg,
                    fontSize: 12,
                    fontWeight: '600',
                  }}
                >
                  {' '}
                  obs{' '}
                </Text>
              );
            }
            return (
              <Fragment key={i}>
                {' '}
                <Text
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/documente/[id]',
                      params: { id: p.id, from: 'medical-chat', entityId: recordId },
                    })
                  }
                  suppressHighlighting={false}
                  style={{
                    color: chipColor,
                    backgroundColor: chipBg,
                    fontSize: 12,
                    fontWeight: '600',
                    textDecorationLine: 'underline',
                  }}
                >
                  {p.label}
                </Text>{' '}
              </Fragment>
            );
          })}
        </Text>

        {msg.citations.length > 0 && msg.role === 'assistant' ? (
          <View style={styles.citationsRow}>
            {msg.citations
              .filter(c => c.type === 'document')
              .slice(0, 3)
              .map((c, i) =>
                c.type === 'document' ? (
                  <Pressable
                    key={`doc-${c.id}-${i}`}
                    onPress={() =>
                      router.push({
                        pathname: '/(tabs)/documente/[id]',
                        params: { id: c.id, from: 'medical-chat', entityId: recordId },
                      })
                    }
                    style={[styles.citationChip, { borderColor: palette.border }]}
                  >
                    <Text style={{ color: palette.text, fontSize: 11 }}>📄 {c.label}</Text>
                  </Pressable>
                ) : null
              )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginVertical: 4,
    paddingHorizontal: 12,
  },
  bubble: {
    maxWidth: '88%',
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  citationsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  citationChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
});
