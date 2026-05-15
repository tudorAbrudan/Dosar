/**
 * Card-ul unui document în lista din ecranul Documente — icon stânga, titlu +
 * entitate + notă, expiry badge dreapta.
 */
import type { ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { primary, primaryTint, statusColors } from '@/theme/colors';
import { DOC_ICON_BG, DOC_ICON_COLOR } from '@/theme/docTypeColors';
import { DOC_ICON } from '@/theme/docTypeIcons';
import { iconColors } from '@/theme/iconColors';
import type { Document } from '@/types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const ENTITY_ICON: Record<string, IoniconName> = {
  person_id: 'person',
  vehicle_id: 'car-outline',
  property_id: 'home-outline',
  card_id: 'card-outline',
  animal_id: 'paw-outline',
  company_id: 'business-outline',
};

function getExpiryInfo(doc: Document): { label: string; bg: string; fg: string } | null {
  if (!doc.expiry_date) return null;
  const exp = new Date(doc.expiry_date).getTime();
  const now = Date.now();
  const daysLeft = Math.ceil((exp - now) / (24 * 60 * 60 * 1000));

  if (daysLeft < 0) {
    // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
    return { label: 'Expirat', bg: statusColors.critical, fg: '#fff' };
  }
  if (daysLeft <= 30) {
    // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
    return { label: `${daysLeft}z`, bg: statusColors.warning, fg: '#fff' };
  }
  const date = new Date(doc.expiry_date);
  const label = date.toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' });
  return { label, bg: primaryTint, fg: primary };
}

interface DocumentListCardProps {
  doc: Document;
  entityName: string | null;
  entityKind: string | null;
  label: string;
  scheme: 'light' | 'dark';
  onPress: () => void;
  onLongPress: () => void;
}

export function DocumentListCard({
  doc,
  entityName,
  entityKind,
  label,
  scheme,
  onPress,
  onLongPress,
}: DocumentListCardProps) {
  const C = Colors[scheme];
  const iconBg = DOC_ICON_BG[doc.type] ?? iconColors.neutral.bg;
  const iconColor = DOC_ICON_COLOR[doc.type] ?? iconColors.neutral.fg;
  const iconName = DOC_ICON[doc.type] ?? 'document-outline';
  const expiry = getExpiryInfo(doc);
  const entityIconName: IoniconName = entityKind
    ? (ENTITY_ICON[entityKind] ?? 'ellipse-outline')
    : 'ellipse-outline';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: C.card, shadowColor: C.cardShadow },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
    >
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={iconName} size={22} color={iconColor} />
      </View>

      <View style={styles.content}>
        <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
          {label}
        </Text>

        {entityName && (
          <View style={styles.entityRow}>
            <Ionicons
              name={entityIconName}
              size={11}
              color={C.textSecondary}
              style={styles.entityIcon}
            />
            <Text style={[styles.entityText, { color: C.textSecondary }]} numberOfLines={1}>
              {entityName}
            </Text>
          </View>
        )}

        {doc.note ? (
          <Text style={[styles.note, { color: C.textSecondary }]} numberOfLines={1}>
            {doc.note}
          </Text>
        ) : null}
      </View>

      <View style={styles.right}>
        {expiry && (
          <View style={[styles.expiryBadge, { backgroundColor: expiry.bg }]}>
            <Text style={[styles.expiryText, { color: expiry.fg }]}>{expiry.label}</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={16} color={C.textSecondary} style={styles.chevron} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  content: { flex: 1, justifyContent: 'center', gap: 2 },
  title: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  entityRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  entityIcon: { marginTop: 1 },
  entityText: { fontSize: 12, lineHeight: 17, flex: 1 },
  note: { fontSize: 12, lineHeight: 17, fontStyle: 'italic' },
  right: { alignItems: 'flex-end', justifyContent: 'center', marginLeft: 8, gap: 4, flexShrink: 0 },
  expiryBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  expiryText: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
  chevron: { marginTop: 2 },
});
