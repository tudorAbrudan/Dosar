/**
 * Header-ul ecranului onboarding — pas curent („1 / 11"), titlu, subtitle +
 * progress bar inferior.
 */
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { primary } from '@/theme/colors';

interface OnboardingHeaderProps {
  scheme: 'light' | 'dark';
  paddingTop: number;
  currentIdx: number;
  totalActive: number;
  title: string;
  subtitle: string;
}

export function OnboardingHeader({
  scheme,
  paddingTop,
  currentIdx,
  totalActive,
  title,
  subtitle,
}: OnboardingHeaderProps) {
  const C = Colors[scheme];
  return (
    <>
      <View style={[styles.header, { paddingTop: paddingTop + 16, borderBottomColor: C.border }]}>
        <Text style={[styles.stepIndicator, { color: C.textSecondary }]}>
          {currentIdx + 1} / {totalActive}
        </Text>
        <Text style={[styles.title, { color: C.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: C.textSecondary }]}>{subtitle}</Text>
      </View>

      <View style={[styles.progressTrack, { backgroundColor: C.border }]}>
        <View style={{ flex: currentIdx + 1, backgroundColor: primary }} />
        <View style={{ flex: Math.max(0, totalActive - currentIdx - 1), minWidth: 0 }} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stepIndicator: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.3, marginBottom: 6 },
  subtitle: { fontSize: 14, lineHeight: 20 },
  progressTrack: { height: 3, width: '100%', flexDirection: 'row', alignItems: 'stretch' },
});
