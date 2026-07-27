import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';

interface SharingBetaSectionProps {
  scheme: 'light' | 'dark';
  onOpenSharing: () => void;
}

export function SharingBetaSection({ scheme, onOpenSharing }: SharingBetaSectionProps) {
  return (
    <SectionCard title="Partajare (Beta)" scheme={scheme}>
      <InfoRow
        icon="people-outline"
        iconBg={iconColors.primary.bg}
        iconColor={primary}
        label="Partajare entități"
        sub="Partajează o entitate cu familia prin iCloud"
        onPress={onOpenSharing}
        isLast
        scheme={scheme}
      />
    </SectionCard>
  );
}
