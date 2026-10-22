import { primary } from '@/theme/colors';
import { iconColors } from '@/theme/iconColors';
import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';

interface AboutSectionProps {
  appName: string;
  appVersion: string;
  checkingUpdate: boolean;
  scheme: 'light' | 'dark';
  onCheckForUpdate: () => void;
}

export function AboutSection({
  appName,
  appVersion,
  checkingUpdate,
  scheme,
  onCheckForUpdate,
}: AboutSectionProps) {
  return (
    <SectionCard title="Despre aplicație" scheme={scheme}>
      <InfoRow
        icon="folder-outline"
        iconBg={iconColors.primary.bg}
        iconColor={primary}
        label={appName}
        sub="Local-first · OCR on-device · fără cont · React Native"
        value={`v${appVersion}`}
        scheme={scheme}
      />
      <InfoRow
        icon="cloud-download-outline"
        iconBg={iconColors.info.bg}
        iconColor={iconColors.info.fg}
        label="Verifică actualizări"
        sub={checkingUpdate ? 'Se verifică...' : `Versiune curentă: ${appVersion}`}
        busy={checkingUpdate}
        onPress={onCheckForUpdate}
        scheme={scheme}
      />
    </SectionCard>
  );
}
