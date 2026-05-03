import { ReactNode } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { light, dark } from '@/theme/colors';

interface Props {
  label?: string;
  value?: string;
  children?: ReactNode;
  /** Suprimă separatorul de jos. Setat automat de DocumentDetailCard pentru ultimul rând. */
  last?: boolean;
}

export function DocumentDetailRow({ label, value, children, last = false }: Props) {
  const scheme = useColorScheme();
  const palette = scheme === 'dark' ? dark : light;

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
  return (
    <View style={[styles.container, styles.inlineRow, separatorStyle]}>
      {label && <Text style={[styles.inlineLabel, { color: palette.textSecondary }]}>{label}</Text>}
      {value !== undefined && (
        <Text style={[styles.inlineValue, { color: palette.text }]}>{value}</Text>
      )}
    </View>
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
