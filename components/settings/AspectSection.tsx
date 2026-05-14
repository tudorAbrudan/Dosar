import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';
import type { ThemePreference } from '@/hooks/useThemeScheme';

interface AspectSectionProps {
  themePref: ThemePreference;
  collapsed: boolean;
  scheme: 'light' | 'dark';
  onToggleCollapsed: () => void;
  onSelectPref: (pref: ThemePreference) => void;
}

const THEME_OPTIONS: [ThemePreference, string][] = [
  ['auto', 'Automat'],
  ['light', 'Clar'],
  ['dark', 'Întunecat'],
];

/**
 * Secțiunea Aspect — chip-uri pentru selectare temă (Auto/Clar/Întunecat).
 * Header colapsabil cu chevron up/down.
 */
export function AspectSection({
  themePref,
  collapsed,
  scheme,
  onToggleCollapsed,
  onSelectPref,
}: AspectSectionProps) {
  const C = Colors[scheme];
  return (
    <>
      <Pressable style={styles.header} onPress={onToggleCollapsed}>
        <Text style={[styles.label, { color: C.textSecondary }]}>ASPECT</Text>
        <Ionicons
          name={collapsed ? 'chevron-down' : 'chevron-up'}
          size={14}
          color={C.textSecondary}
        />
      </Pressable>
      {!collapsed && (
        <View style={[styles.card, { backgroundColor: C.card, shadowColor: C.cardShadow }]}>
          <Text style={[styles.hint, { color: C.textSecondary }]}>
            Alege tema de culori a aplicației.
          </Text>
          <View style={[styles.chipRow, { marginTop: 8 }]}>
            {THEME_OPTIONS.map(([value, label]) => {
              const isActive = themePref === value;
              return (
                <Pressable
                  key={value}
                  style={[
                    styles.chip,
                    isActive
                      ? [styles.chipActive, { borderColor: primary }]
                      : { borderColor: C.border },
                  ]}
                  onPress={() => onSelectPref(value)}
                  accessibilityLabel={`Temă ${label}`}
                >
                  <Text style={[styles.chipText, { color: isActive ? '#fff' : C.textSecondary }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
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
    ...Platform.select({
      ios: {
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 4,
      },
      android: { elevation: 2 },
    }),
  },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: primary },
  chipText: { fontSize: 13, fontWeight: '500' },
});
