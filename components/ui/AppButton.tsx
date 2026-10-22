import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  Text,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { onPrimary, statusColors } from '@/theme/colors';
import { radius } from '@/theme/layout';

/** `danger` = contur roșu, pentru acțiuni care șterg ceva. */
type Variant = 'primary' | 'secondary' | 'outline' | 'danger';

interface AppButtonProps {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  icon?: React.ReactNode;
  /** Rotiță în locul iconiței; butonul nu mai răspunde cât rulează. */
  loading?: boolean;
  accessibilityLabel?: string;
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
  textStyle,
  icon,
  loading,
  accessibilityLabel,
}: AppButtonProps) {
  const scheme = (useColorScheme() ?? 'light') as 'light' | 'dark';
  const C = Colors[scheme];

  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  const isOutline = variant === 'outline';
  const isDanger = variant === 'danger';
  const fg = isPrimary ? onPrimary : isDanger ? statusColors.critical : C.primary;

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={({ pressed }) => [
        styles.base,
        isPrimary && { backgroundColor: C.primary },
        isSecondary && { backgroundColor: C.primaryMuted },
        isOutline && {
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderColor: C.primary,
        },
        isDanger && {
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderColor: statusColors.critical,
        },
        pressed && !disabled && { opacity: 0.88 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon}
      <Text style={[styles.label, { color: fg }, textStyle]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.pill,
    minHeight: 48,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
});
