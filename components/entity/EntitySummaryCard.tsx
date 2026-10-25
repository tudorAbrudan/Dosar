/**
 * Cardul „Situație" de pe ecranul unei entități: ce a expirat, ce expiră curând,
 * ce document esențial lipsește și ce e valabil, ordonat după urgență. Datele
 * vin din `buildEntitySummary` — aceeași fișă pe care o primește asistentul.
 *
 * Nu se afișează la vehicule: acolo bara de status și obligațiile legale arată
 * deja același lucru.
 */
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useColorScheme } from '@/components/useColorScheme';
import { useVisibilitySettings } from '@/hooks/useVisibilitySettings';
import {
  buildEntitySummary,
  describeSummaryItem,
  type EntitySummaryItem,
} from '@/services/entitySummary';
import { dark, light, primary, statusColors } from '@/theme/colors';
import type { CustomDocumentType, Document, EntityType } from '@/types';

interface EntitySummaryCardProps {
  entityType: EntityType;
  entityId: string;
  documents: Document[];
  customTypes: CustomDocumentType[];
  readOnly: boolean;
}

export function EntitySummaryCard({
  entityType,
  entityId,
  documents,
  customTypes,
  readOnly,
}: EntitySummaryCardProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const { visibleDocTypes, loading: visibilityLoading } = useVisibilitySettings();

  const items = useMemo(
    () =>
      buildEntitySummary({
        entityType,
        documents,
        // Până se încarcă setările nu știm ce tipuri a ascuns userul: fără
        // „lipsește" decât apoi, ca să nu apară și să dispară un rând.
        visibleDocTypes: visibilityLoading ? [] : visibleDocTypes,
        customTypes,
      }),
    [entityType, documents, visibilityLoading, visibleDocTypes, customTypes]
  );

  if (items.length === 0) return null;

  const open = (item: EntitySummaryItem) => {
    if (item.docId) {
      router.push({
        pathname: '/(tabs)/documente/[id]',
        params: { id: item.docId, from: 'entity', entityId },
      });
    } else {
      router.push({
        pathname: '/(tabs)/documente/add',
        params: { [`${entityType}_id`]: entityId, type: item.type },
      });
    }
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.title, { color: palette.textSecondary }]}>SITUAȚIE</Text>
      <View
        style={[styles.card, { backgroundColor: palette.card, shadowColor: palette.cardShadow }]}
      >
        {items.map((item, index) => {
          const isMissing = item.status === 'missing';
          const actionable = !isMissing || !readOnly;
          const description = describeSummaryItem(item);
          const valueColor =
            item.status === 'expired'
              ? statusColors.critical
              : item.status === 'expiring'
                ? statusColors.warning
                : palette.textSecondary;
          return (
            <Pressable
              key={item.key}
              onPress={() => open(item)}
              disabled={!actionable}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}, ${description}${isMissing && actionable ? ', adaugă' : ''}`}
              style={({ pressed }) => [
                styles.row,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: palette.border,
                },
                pressed && styles.rowPressed,
              ]}
            >
              <View style={styles.marker}>
                {isMissing ? (
                  <Ionicons name="add-circle-outline" size={18} color={palette.textSecondary} />
                ) : (
                  <View style={[styles.dot, { backgroundColor: statusColors[dotKey(item)] }]} />
                )}
              </View>
              <View style={styles.content}>
                <Text style={[styles.label, { color: palette.text }]} numberOfLines={2}>
                  {item.label}
                </Text>
                <Text style={[styles.value, { color: valueColor }]}>
                  {description}
                  {isMissing && actionable ? (
                    <Text style={[styles.add, { color: primary }]}> · Adaugă</Text>
                  ) : null}
                </Text>
              </View>
              {actionable && (
                <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function dotKey(item: EntitySummaryItem): 'critical' | 'warning' | 'ok' {
  if (item.status === 'expired') return 'critical';
  if (item.status === 'expiring') return 'warning';
  return 'ok';
}

const styles = StyleSheet.create({
  section: { marginBottom: 16 },
  title: { fontSize: 12, fontWeight: '600', letterSpacing: 0.6, marginBottom: 8 },
  card: {
    borderRadius: 12,
    paddingHorizontal: 16,
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  rowPressed: { opacity: 0.7 },
  marker: { width: 18, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  content: { flex: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: '500' },
  value: { fontSize: 13 },
  add: { fontWeight: '600' },
});
