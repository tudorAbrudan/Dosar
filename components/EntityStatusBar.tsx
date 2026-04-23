import { memo } from 'react';
import {
  StyleSheet,
  ScrollView,
  Pressable,
  View,
  Text,
  Platform,
  useColorScheme,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { statusColors, primary, light, dark } from '@/theme/colors';
import type { VehicleStatusItem } from '@/hooks/useVehicleStatus';

function iconForKey(key: VehicleStatusItem['key']): keyof typeof Ionicons.glyphMap {
  switch (key) {
    case 'rca':
      return 'shield-outline';
    case 'casco':
      return 'shield-checkmark-outline';
    case 'itp':
      return 'clipboard-outline';
    case 'service':
      return 'construct-outline';
    case 'fuel':
      return 'flame-outline';
  }
}

function Sparkline({ values }: { values: number[] }) {
  const width = 108;
  const height = 14;
  if (values.length < 2) {
    return <View style={{ width, height }} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Svg width={width} height={height}>
      <Polyline points={points} fill="none" stroke={primary} strokeWidth={1.5} />
    </Svg>
  );
}

type CardProps = {
  item: VehicleStatusItem;
  textSecondary: string;
  cardBg: string;
  cardShadow: string;
};

const StatusCard = memo(function StatusCard({
  item,
  textSecondary,
  cardBg,
  cardShadow,
}: CardProps) {
  const severityColor = statusColors[item.severity];
  const isCritical = item.severity === 'critical';
  const isFuel = item.key === 'fuel';

  return (
    <Pressable
      onPress={item.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.label}, ${item.value}${
        item.unit ? ' ' + item.unit : ''
      }${isCritical ? ', urgent' : item.severity === 'warning' ? ', atenție' : ''}`}
      hitSlop={8}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: cardBg,
          shadowColor: cardShadow,
          width: isFuel ? 148 : 124,
        },
        isCritical && { borderLeftWidth: 3, borderLeftColor: statusColors.critical },
        pressed && styles.cardPressed,
      ]}
    >
      <View style={styles.cardTopRow}>
        <Ionicons name={iconForKey(item.key)} size={18} color={textSecondary} />
        <View style={[styles.dot, { backgroundColor: severityColor }]} />
      </View>
      <Text style={[styles.label, { color: textSecondary }]} numberOfLines={1}>
        {item.label}
      </Text>
      <Text style={[styles.value, { color: severityColor }]} numberOfLines={1}>
        {item.value}
        {item.unit ? (
          <Text style={[styles.unit, { color: textSecondary }]}> {item.unit}</Text>
        ) : null}
      </Text>
      {isFuel && item.sparkline && item.sparkline.length >= 2 ? (
        <Sparkline values={item.sparkline} />
      ) : item.subValue ? (
        <Text style={[styles.subValue, { color: textSecondary }]} numberOfLines={1}>
          {item.subValue}
        </Text>
      ) : null}
    </Pressable>
  );
});

export function EntityStatusBar({ items }: { items: VehicleStatusItem[] }) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;
  if (items.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.barContent}
    >
      {items.map(item => (
        <StatusCard
          key={item.key}
          item={item}
          textSecondary={palette.textSecondary}
          cardBg={palette.card}
          cardShadow={palette.cardShadow}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginVertical: 8,
  },
  barContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  card: {
    height: 80,
    borderRadius: 12,
    padding: 10,
    justifyContent: 'space-between',
    ...Platform.select({
      ios: { shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8 },
      android: { elevation: 2 },
    }),
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 18,
    fontWeight: '700',
  },
  unit: {
    fontSize: 11,
    fontWeight: '400',
  },
  subValue: {
    fontSize: 11,
    fontWeight: '400',
  },
});
