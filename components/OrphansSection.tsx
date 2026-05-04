import { useState } from 'react';
import { StyleSheet, Pressable, Platform, View as RNView, Text as RNText } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { radius } from '@/theme/layout';
import type { OrphanGroup, OrphanFixKind } from '@/services/orphans';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function navigateToFix(kind: OrphanFixKind, id: string): void {
  if (kind === 'document_edit') {
    router.push(`/(tabs)/documente/${id}?from=home`);
  } else {
    router.push(`/(tabs)/entitati/${id}?edit=1`);
  }
}

interface OrphansSectionProps {
  groups: OrphanGroup[];
  onItemPress?: () => void;
}

export function OrphansSection({ groups, onItemPress }: OrphansSectionProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];
  const [expanded, setExpanded] = useState<string | null>(null);

  if (groups.length === 0) return null;

  const total = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <RNView style={styles.section}>
      <RNView style={styles.sectionHeader}>
        <RNText style={[styles.sectionLabel, { color: C.textSecondary }]}>DE COMPLETAT</RNText>
        <RNView style={[styles.totalBadge, { backgroundColor: '#FFF3E0' }]}>
          <RNText style={[styles.totalBadgeText, { color: '#E65100' }]}>{total}</RNText>
        </RNView>
      </RNView>

      {groups.map(group => {
        const isOpen = expanded === group.key;
        return (
          <RNView
            key={group.key}
            style={[styles.groupCard, { backgroundColor: C.card, shadowColor: C.cardShadow }]}
          >
            <Pressable
              style={styles.groupHeader}
              onPress={() => setExpanded(prev => (prev === group.key ? null : group.key))}
            >
              <RNView style={[styles.groupIcon, { backgroundColor: group.iconBg }]}>
                <Ionicons name={group.icon as IoniconName} size={18} color={group.iconColor} />
              </RNView>
              <RNView style={styles.groupContent}>
                <RNText style={[styles.groupTitle, { color: C.text }]} numberOfLines={1}>
                  {group.title}
                </RNText>
                <RNText style={[styles.groupDesc, { color: C.textSecondary }]} numberOfLines={1}>
                  {group.description}
                </RNText>
              </RNView>
              <Ionicons
                name={isOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={C.textSecondary}
              />
            </Pressable>

            {isOpen && (
              <RNView style={[styles.itemsList, { borderTopColor: C.border }]}>
                {group.items.map((item, idx) => {
                  const isLast = idx === group.items.length - 1;
                  return (
                    <Pressable
                      key={item.id}
                      style={[
                        styles.item,
                        !isLast && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: C.border,
                        },
                      ]}
                      onPress={() => {
                        onItemPress?.();
                        navigateToFix(item.fixKind, item.fixId);
                      }}
                    >
                      <RNView style={styles.itemContent}>
                        <RNText style={[styles.itemLabel, { color: C.text }]} numberOfLines={1}>
                          {item.label}
                        </RNText>
                        <RNText
                          style={[styles.itemHint, { color: C.textSecondary }]}
                          numberOfLines={1}
                        >
                          {item.hint}
                        </RNText>
                      </RNView>
                      <Ionicons name="chevron-forward" size={14} color={C.textSecondary} />
                    </Pressable>
                  );
                })}
              </RNView>
            )}
          </RNView>
        );
      })}
    </RNView>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  totalBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  totalBadgeText: { fontSize: 12, fontWeight: '700' },

  groupCard: {
    borderRadius: radius.lg,
    marginBottom: 8,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4 },
      android: { elevation: 2 },
    }),
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
  },
  groupIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  groupContent: { flex: 1 },
  groupTitle: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  groupDesc: { fontSize: 12, lineHeight: 16, marginTop: 1 },

  itemsList: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  itemContent: { flex: 1 },
  itemLabel: { fontSize: 13, fontWeight: '500', lineHeight: 17 },
  itemHint: { fontSize: 11, lineHeight: 14, marginTop: 1 },
});
