import { View, Text, Switch, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { ALL_ENTITY_TYPES, ENTITY_TYPE_LABELS, ENTITY_TYPE_EMOJI } from '@/types';
import type { EntityType } from '@/types';

interface VizibilitateEntitatiSectionProps {
  visibleEntityTypes: EntityType[];
  collapsed: boolean;
  scheme: 'light' | 'dark';
  onToggleCollapsed: () => void;
  onToggleEntityType: (type: EntityType) => void;
}

export function VizibilitateEntitatiSection({
  visibleEntityTypes,
  collapsed,
  scheme,
  onToggleCollapsed,
  onToggleEntityType,
}: VizibilitateEntitatiSectionProps) {
  const C = Colors[scheme];
  return (
    <>
      <Pressable style={styles.header} onPress={onToggleCollapsed}>
        <Text style={[styles.label, { color: C.textSecondary }]}>ENTITĂȚI ACTIVE</Text>
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={14}
          color={C.textSecondary}
        />
      </Pressable>
      {!collapsed && (
        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <Text style={[styles.hint, { color: C.textSecondary }]}>
            Alege ce tipuri de entități să apară în aplicație. Entitățile dezactivate nu vor
            apărea în formulare sau liste.
          </Text>
          {ALL_ENTITY_TYPES.map((entityType, idx) => {
            const isActive = visibleEntityTypes.includes(entityType);
            const isLast = idx === ALL_ENTITY_TYPES.length - 1;
            return (
              <View
                key={entityType}
                style={[isLast ? styles.rowLast : styles.row, { borderBottomColor: C.border }]}
              >
                <View style={styles.rowLeft}>
                  <View
                    style={[styles.rowIcon, { backgroundColor: isActive ? iconColors.primary.bg : C.border }]}
                  >
                    <Text style={styles.entityEmoji}>{ENTITY_TYPE_EMOJI[entityType]}</Text>
                  </View>
                  <Text style={[styles.rowLabel, { color: C.text }]}>
                    {ENTITY_TYPE_LABELS[entityType]}
                  </Text>
                </View>
                <Switch
                  value={isActive}
                  onValueChange={() => onToggleEntityType(entityType)}
                  trackColor={{ false: C.border, true: primary }}
                  thumbColor="#fff"
                />
              </View>
            );
          })}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 8,
    marginLeft: 4,
    marginRight: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    flex: 1,
  },
  card: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  entityEmoji: { fontSize: 16 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
});
