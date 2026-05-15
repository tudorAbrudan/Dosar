import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
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
        iconBg={iconColors.primary.bg}
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
