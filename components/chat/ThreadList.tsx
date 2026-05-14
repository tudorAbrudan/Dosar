import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
  Platform,
} from 'react-native';
import type { ChatThread } from '@/services/chatThreads';

export interface ThreadListColors {
  background: string;
  surface: string;
  border: string;
  text: string;
  textSecondary: string;
  primary: string;
}

interface ThreadListProps {
  threads: ChatThread[];
  colors: ThreadListColors;
  insets: { top: number; bottom: number };
  onSelect: (thread: ChatThread) => void;
  onNew: () => void;
  onRename: (thread: ChatThread) => void;
  onDelete: (thread: ChatThread) => void;
  loading: boolean;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'acum';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} ore`;
  return d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit' });
}

/**
 * Lista conversațiilor din chat. Long-press deschide Alert cu Redenumește / Șterge.
 */
export function ThreadList({
  threads,
  colors,
  insets,
  onSelect,
  onNew,
  onRename,
  onDelete,
  loading,
}: ThreadListProps) {
  return (
    <View
      style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Conversații</Text>
        <Pressable
          style={[styles.newBtn, { backgroundColor: colors.primary }]}
          onPress={onNew}
          accessibilityLabel="Conversație nouă"
        >
          <Text style={styles.newBtnText}>+ Nouă</Text>
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
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        >
          {threads.map(thread => (
            <Pressable
              key={thread.id}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => onSelect(thread)}
              onLongPress={() =>
                Alert.alert(thread.name, 'Ce vrei să faci cu această conversație?', [
                  { text: 'Redenumește', onPress: () => onRename(thread) },
                  { text: 'Șterge', style: 'destructive', onPress: () => onDelete(thread) },
                  { text: 'Anulează', style: 'cancel' },
                ])
              }
            >
              <View style={styles.cardContent}>
                <View style={styles.cardLeft}>
                  <Text style={[styles.cardName, { color: colors.text }]} numberOfLines={1}>
                    {thread.name}
                  </Text>
                  {thread.lastMessage && (
                    <Text
                      style={[styles.cardPreview, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {thread.lastMessage}
                    </Text>
                  )}
                </View>
                <View style={styles.cardRight}>
                  <Text style={[styles.cardTime, { color: colors.textSecondary }]}>
                    {formatTime(thread.updated_at)}
                  </Text>
                  <Text style={[styles.cardCount, { color: colors.textSecondary }]}>
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 22, fontWeight: '700' },
  newBtn: { borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  newBtnText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
  card: {
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
  cardContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardLeft: { flex: 1 },
  cardName: { fontSize: 15, fontWeight: '600', marginBottom: 2 },
  cardPreview: { fontSize: 13, lineHeight: 18 },
  cardRight: { alignItems: 'flex-end', gap: 4 },
  cardTime: { fontSize: 12 },
  cardCount: { fontSize: 11 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptySubtitle: { fontSize: 14 },
});
