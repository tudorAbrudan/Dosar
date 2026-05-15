import { Linking } from 'react-native';
import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';
import { iconColors } from '@/theme/iconColors';

const APP_STORE_REVIEW_URL =
  'itms-apps://itunes.apple.com/app/id6760576986?action=write-review';

interface ContactSectionProps {
  contactEmail: string;
  supportUrl: string;
  scheme: 'light' | 'dark';
  onContact: () => void;
  onOpenSupport: () => void;
}

export function ContactSection({
  contactEmail,
  supportUrl,
  scheme,
  onContact,
  onOpenSupport,
}: ContactSectionProps) {
  return (
    <SectionCard title="Contact și suport" scheme={scheme}>
      <InfoRow
        icon="mail-outline"
        iconBg={iconColors.indigo.bg}
        iconColor={iconColors.indigo.fg}
        label="Contactează suport aplicație"
        sub={contactEmail}
        onPress={onContact}
        scheme={scheme}
      />
      <InfoRow
        icon="globe-outline"
        iconBg={iconColors.teal.bg}
        iconColor={iconColors.teal.fg}
        label="Site web și suport"
        sub={supportUrl}
        onPress={onOpenSupport}
        scheme={scheme}
      />
      <InfoRow
        icon="star-outline"
        iconBg={iconColors.amber.bg}
        iconColor={iconColors.amber.fg}
        label="Evaluează aplicația"
        sub="Ne ajuți cu o recenzie pe App Store"
        onPress={() => Linking.openURL(APP_STORE_REVIEW_URL)}
        isLast
        scheme={scheme}
      />
    </SectionCard>
  );
}
