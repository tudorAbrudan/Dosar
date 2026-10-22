import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';

interface PrivacyGdprSectionProps {
  scheme: 'light' | 'dark';
  onShowPrivacy: () => void;
  onShowTerms: () => void;
  onDeleteAllData: () => void;
}

export function PrivacyGdprSection({
  scheme,
  onShowPrivacy,
  onShowTerms,
  onDeleteAllData,
}: PrivacyGdprSectionProps) {
  return (
    <SectionCard title="Date și confidențialitate" scheme={scheme}>
      <InfoRow
        icon="shield-checkmark-outline"
        iconBg={iconColors.primary.bg}
        iconColor={primary}
        label="Politică de confidențialitate"
        sub="Cum sunt protejate datele tale · local pe dispozitiv"
        onPress={onShowPrivacy}
        scheme={scheme}
      />
      <InfoRow
        icon="document-text-outline"
        iconBg={iconColors.info.bg}
        iconColor={iconColors.info.fg}
        label="Termeni și condiții"
        onPress={onShowTerms}
        scheme={scheme}
      />
      {/* Tot rândul e apăsabil (înainte doar săgeata); confirmarea e în handler. */}
      <InfoRow
        icon="trash-outline"
        iconBg={iconColors.pink.bg}
        iconColor={iconColors.pink.fg}
        label="Șterge toate datele"
        destructive
        onPress={onDeleteAllData}
        scheme={scheme}
      />
    </SectionCard>
  );
}
