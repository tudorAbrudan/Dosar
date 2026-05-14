import { primary } from '@/theme/colors';
import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';

interface OnboardingSectionProps {
  scheme: 'light' | 'dark';
  onResetOnboarding: () => void;
}

export function OnboardingSection({ scheme, onResetOnboarding }: OnboardingSectionProps) {
  return (
    <SectionCard title="Onboarding" scheme={scheme}>
      <InfoRow
        icon="rocket-outline"
        iconBg="#E8F5E9"
        iconColor={primary}
        label="Reluare onboarding"
        sub="Resetează vizibilitatea tipurilor de documente la valorile implicite"
        onPress={onResetOnboarding}
        isLast
        scheme={scheme}
      />
    </SectionCard>
  );
}
