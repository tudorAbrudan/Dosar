/**
 * Footer-ul ecranului onboarding — buton „Înapoi" (de la pasul 2), buton
 * primar („Continuă" / „Finalizează") + buton secundar „Sari peste configurare"
 * (ascuns la SUMMARY și AI_STEP).
 */
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import Colors from '@/constants/Colors';
import { radius } from '@/theme/layout';

interface OnboardingFooterProps {
  scheme: 'light' | 'dark';
  paddingBottom: number;
  showBack: boolean;
  showSkip: boolean;
  isLastStep: boolean;
  isSingleButton: boolean;
  nextDisabled: boolean;
  skipDisabled: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

export function OnboardingFooter({
  scheme,
  paddingBottom,
  showBack,
  showSkip,
  isLastStep,
  isSingleButton,
  nextDisabled,
  skipDisabled,
  onBack,
  onNext,
  onSkip,
}: OnboardingFooterProps) {
  const C = Colors[scheme];
  return (
    <View
      style={[
        styles.footer,
        {
          paddingBottom: paddingBottom + 16,
          borderTopColor: C.border,
          backgroundColor: C.surface,
          borderTopLeftRadius: radius.xl,
          borderTopRightRadius: radius.xl,
          ...Platform.select({
            ios: {
              // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -3 },
              shadowOpacity: 0.06,
              shadowRadius: 10,
            },
            android: { elevation: 12 },
            default: {},
          }),
        },
      ]}
    >
      <View style={styles.row}>
        {showBack && (
          <Pressable
            style={({ pressed }) => [
              styles.btnBack,
              { borderColor: C.primary, opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={onBack}
          >
            <Text style={[styles.btnBackText, { color: C.primary }]}>Înapoi</Text>
          </Pressable>
        )}
        <Pressable
          style={({ pressed }) => [
            styles.btnNext,
            isSingleButton && styles.btnNextSingle,
            { backgroundColor: C.primary, opacity: nextDisabled ? 0.4 : pressed ? 0.85 : 1 },
          ]}
          onPress={onNext}
          disabled={nextDisabled}
        >
          <Text style={styles.btnNextText}>{isLastStep ? 'Finalizează' : 'Continuă'}</Text>
        </Pressable>
      </View>
      {showSkip && (
        <Pressable
          style={({ pressed }) => [
            styles.btnSkip,
            { opacity: skipDisabled ? 0.4 : pressed ? 0.6 : 1 },
          ]}
          onPress={onSkip}
          disabled={skipDisabled}
        >
          <Text style={[styles.btnSkipText, { color: C.textSecondary }]}>
            Sari peste configurare
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'column',
    gap: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', gap: 10 },
  btnBack: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnBackText: { fontSize: 16, fontWeight: '600' },
  btnNext: {
    flex: 2,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
  },
  btnNextSingle: { flex: 1 },
  // eslint-disable-next-line local-rules/no-hardcoded-hex-colors
  btnNextText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnSkip: { alignItems: 'center', paddingVertical: 8 },
  btnSkipText: { fontSize: 13, textDecorationLine: 'underline' },
});
