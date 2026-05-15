import { View, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { primary, statusColors } from '@/theme/colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export interface BottomAction {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  color?: string;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
}

interface Props {
  /** Rândul principal de acțiuni */
  actions: BottomAction[];
  /** Rând opțional deasupra (ex: acțiuni specifice vehiculelor) */
  topActions?: BottomAction[];
}

export function BottomActionBar({ actions, topActions }: Props) {
  const insets = useSafeAreaInsets();
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  function renderAction(action: BottomAction, index: number, total: number) {
    const color = action.danger ? statusColors.critical : (action.color ?? primary);
    const isLast = index === total - 1;

    return (
      <Pressable
        key={index}
        style={({ pressed }) => [
          styles.item,
          !isLast && { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: C.border },
          (action.disabled || action.loading) && styles.itemDisabled,
          pressed && styles.itemPressed,
        ]}
        onPress={action.onPress}
        disabled={action.disabled || action.loading}
      >
        {action.loading ? (
          <ActivityIndicator size="small" color={color} />
        ) : (
          <Ionicons name={action.icon} size={22} color={color} />
        )}
        <Text style={[styles.label, { color }]} numberOfLines={1}>
          {action.label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.bar,
        {
          backgroundColor: C.card,
          borderTopColor: C.border,
          paddingBottom: 0,
        },
      ]}
    >
      {topActions && topActions.length > 0 && (
        <View style={[styles.row, styles.topRow, { borderBottomColor: C.border }]}>
          {topActions.map((a, i) => renderAction(a, i, topActions.length))}
        </View>
      )}
      <View style={styles.row}>{actions.map((a, i) => renderAction(a, i, actions.length))}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
    }),
  },
  row: {
    flexDirection: 'row',
  },
  topRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 2,
  },
  itemDisabled: {
    opacity: 0.4,
  },
  itemPressed: {
    opacity: 0.6,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
});
