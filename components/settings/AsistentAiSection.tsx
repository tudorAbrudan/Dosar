import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';
import * as aiProvider from '@/services/aiProvider';
import type { AiProviderType } from '@/services/aiProvider';

interface AsistentAiSectionProps {
  aiProviderType: AiProviderType;
  aiConsentGiven: boolean;
  scheme: 'light' | 'dark';
  onOpenAiModal: () => void;
}

export function AsistentAiSection({
  aiProviderType,
  aiConsentGiven,
  scheme,
  onOpenAiModal,
}: AsistentAiSectionProps) {
  const providerLabel = aiProvider.PROVIDER_DEFAULTS[aiProviderType].label;
  const showConsentBadge =
    aiConsentGiven && (aiProviderType === 'builtin' || aiProviderType === 'external');

  return (
    <SectionCard title="Asistent AI" scheme={scheme}>
      <InfoRow
        icon="sparkles-outline"
        iconBg="#EDE7F6"
        iconColor="#4527A0"
        label="Provider AI"
        sub={providerLabel + (showConsentBadge ? ' · Acord acordat' : '')}
        onPress={onOpenAiModal}
        isLast
        scheme={scheme}
      />
    </SectionCard>
  );
}
