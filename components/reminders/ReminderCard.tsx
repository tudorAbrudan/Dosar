/**
 * ReminderCard — card reutilizabil pentru ecranul de Remindere.
 *
 * Randează atât source_type='document_expiry' (identic cu cardurile din Expirări)
 * cât și source_type='medical_ai' (accent roșu medical + subtitle "Dosar medical — Nume").
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark, primary, primaryTint, onPrimary, statusColors } from '@/theme/colors';
import { DOC_ICON } from '@/theme/docTypeIcons';
import { DOC_ICON_BG, DOC_ICON_COLOR } from '@/theme/docTypeColors';
import { iconColors } from '@/theme/iconColors';
import { useEntities } from '@/hooks/useEntities';
import { useDocuments } from '@/hooks/useDocuments';
import { useCustomTypes } from '@/hooks/useCustomTypes';
import { getDocumentLabel } from '@/types';
import { resolveDocumentEntityName } from '@/services/documentEntityName';
import type { Reminder } from '@/types';

interface ReminderCardProps {
  reminder: Reminder;
  onPress?: (r: Reminder) => void;
}

function getDaysUntil(date: string): number {
  const target = new Date(date).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getStatusBadge(reminderDate: string): { label: string; bg: string; fg: string } {
  const days = getDaysUntil(reminderDate);
  if (days < 0)
    return { label: 'Expirat', bg: statusColors.critical, fg: onPrimary };
  if (days === 0)
    return { label: 'Astăzi', bg: statusColors.critical, fg: onPrimary };
  if (days <= 30)
    return { label: `${days}z`, bg: statusColors.warning, fg: onPrimary };
  const label = new Date(reminderDate).toLocaleDateString('ro-RO', {
    month: 'short',
    year: 'numeric',
  });
  return { label, bg: primaryTint, fg: primary };
}

export function ReminderCard({ reminder, onPress }: ReminderCardProps) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  const { persons, properties, vehicles, cards, animals, companies } = useEntities();
  const { documents } = useDocuments();
  const { customTypes } = useCustomTypes();

  const document = reminder.document_id
    ? documents.find(d => d.id === reminder.document_id) ?? null
    : null;

  const isMedical = reminder.source_type === 'medical_ai';

  // ── Icon ──────────────────────────────────────────────────────────────────
  let iconName: string;
  let iconBg: string;
  let iconColor: string;

  if (isMedical) {
    iconName = 'medkit';
    iconBg = iconColors.danger.bg;
    iconColor = iconColors.danger.fg;
  } else if (document) {
    iconName = DOC_ICON[document.type] ?? 'document-outline';
    iconBg = DOC_ICON_BG[document.type] ?? iconColors.neutral.bg;
    iconColor = DOC_ICON_COLOR[document.type] ?? iconColors.neutral.fg;
  } else {
    iconName = 'document-outline';
    iconBg = iconColors.neutral.bg;
    iconColor = iconColors.neutral.fg;
  }

  // ── Title & Subtitle ──────────────────────────────────────────────────────
  let title: string;
  let subtitle: string;

  if (isMedical) {
    title = reminder.label;
    const personName = reminder.person_id
      ? (persons.find(p => p.id === reminder.person_id)?.name ?? '—')
      : '—';
    subtitle = `Dosar medical — ${personName}`;
  } else if (document) {
    title = getDocumentLabel(document, customTypes);
    const entityName = resolveDocumentEntityName(document, {
      persons,
      properties,
      vehicles,
      cards,
      animals,
      companies,
    });
    subtitle = entityName ?? '';
  } else {
    title = reminder.label;
    subtitle = '';
  }

  // ── Status badge ──────────────────────────────────────────────────────────
  const badge = getStatusBadge(reminder.reminder_date);

  // ── Border color (mirrors getExpiryBorderColor from expirari.tsx) ─────────
  const borderColor = badge.bg;

  return (
    <Pressable
      onPress={() => onPress?.(reminder)}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.card, shadowColor: palette.cardShadow, borderLeftColor: borderColor },
        pressed && styles.cardPressed,
      ]}
      android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
    >
      {/* Left: type icon */}
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={iconName as React.ComponentProps<typeof Ionicons>['name']} size={22} color={iconColor} />
      </View>

      {/* Middle: text */}
      <View style={styles.cardContent}>
        <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.cardSub, { color: palette.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {/* Right: badge + chevron */}
      <View style={styles.cardRight}>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={palette.textSecondary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderLeftWidth: 4,
    padding: 14,
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  cardContent: {
    flex: 1,
    justifyContent: 'center',
    gap: 2,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  cardSub: {
    fontSize: 12,
    lineHeight: 17,
  },
  cardRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 8,
    gap: 4,
    flexShrink: 0,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
});
