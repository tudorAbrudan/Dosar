import { ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, View, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';

interface Props {
  label?: string;
  value?: string;
  children?: ReactNode;
  /** Suprimă separatorul de jos. Setat automat de DocumentDetailCard pentru ultimul rând. */
  last?: boolean;
  /** Default: true când avem `value` scalar și nu `children`. Long-press copiază `value` în clipboard. */
  copyable?: boolean;
  /** Default: `label`. Folosit în Alert: „<copyLabel> a fost copiat în clipboard.". */
  copyLabel?: string;
}

export function DocumentDetailRow({
  label,
  value,
  children,
  last = false,
  copyable,
  copyLabel,
}: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

  const isCopyable = (copyable ?? true) && !children && value !== undefined && value !== '';

  async function handleCopy() {
    if (!isCopyable || value === undefined) return;
    try {
      await Clipboard.setStringAsync(value);
      const fieldLabel = copyLabel ?? label ?? 'Valoarea';
      Alert.alert('Copiat', `${fieldLabel} a fost copiat în clipboard.`);
    } catch {
      // Foarte improbabil pe iOS/Android. Silent fail.
    }
  }

  const separatorStyle = last
    ? null
    : { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border };

  // Layout stacked când avem children (conținut bogat: chips, notă, buton)
  if (children) {
    return (
      <View style={[styles.container, separatorStyle]}>
        {label && (
          <Text style={[styles.stackedLabel, { color: palette.textSecondary }]}>{label}</Text>
        )}
        {children}
      </View>
    );
  }

  // Layout inline când avem label + valoare scalară
  const inlineContent = (
    <>
      {label && <Text style={[styles.inlineLabel, { color: palette.textSecondary }]}>{label}</Text>}
      {value !== undefined && (
        <Text style={[styles.inlineValue, { color: palette.text }]}>{value}</Text>
      )}
    </>
  );

  if (isCopyable) {
    return (
      <Pressable
        onLongPress={handleCopy}
        style={[styles.container, styles.inlineRow, separatorStyle]}
      >
        {inlineContent}
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, styles.inlineRow, separatorStyle]}>{inlineContent}</View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  inlineLabel: {
    fontSize: 13,
    flexShrink: 0,
  },
  inlineValue: {
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  stackedLabel: {
    fontSize: 13,
    marginBottom: 6,
  },
});
