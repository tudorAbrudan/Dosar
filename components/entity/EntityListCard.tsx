/**
 * Card-ul unei entități în lista din ecranul Entități (toate, persoane,
 * proprietăți etc.). Variantă: pentru `vehicle` cu `photo_uri` se folosește
 * `VehiclePhotoCard`; altfel `EntityListCard`.
 */
import type { ComponentProps } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text } from '@/components/Themed';
import { LONG_PRESS_DELAY_MS } from '@/components/DraggableEntityList';
import Colors from '@/constants/Colors';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface EntityListCardProps {
  title: string;
  subtitle: string | null;
  icon: IoniconName;
  iconBg: string;
  iconColor: string;
  scheme: 'light' | 'dark';
  isActive: boolean;
  onPress: () => void;
  onLongPress: () => void;
}

export function EntityListCard({
  title,
  subtitle,
  icon,
  iconBg,
  iconColor,
  scheme,
  isActive,
  onPress,
  onLongPress,
}: EntityListCardProps) {
  const C = Colors[scheme];
  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: C.card, shadowColor: C.cardShadow },
        pressed && styles.pressed,
        isActive && styles.active,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_DELAY_MS}
      android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: false }}
    >
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={22} color={iconColor} />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[styles.sub, { color: C.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  active: { opacity: 0.95 },
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
  sub: { fontSize: 12, lineHeight: 17 },
});
