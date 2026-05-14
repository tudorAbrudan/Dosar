import { Linking } from 'react-native';
import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';

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
        iconBg="#E8EAF6"
        iconColor="#283593"
        label="Contactează suport aplicație"
        sub={contactEmail}
        onPress={onContact}
        scheme={scheme}
      />
      <InfoRow
        icon="globe-outline"
        iconBg="#E0F2F1"
        iconColor="#00695C"
        label="Site web și suport"
        sub={supportUrl}
        onPress={onOpenSupport}
        scheme={scheme}
      />
      <InfoRow
        icon="star-outline"
        iconBg="#FFF8E1"
        iconColor="#F57F17"
        label="Evaluează aplicația"
        sub="Ne ajuți cu o recenzie pe App Store"
        onPress={() => Linking.openURL(APP_STORE_REVIEW_URL)}
        isLast
        scheme={scheme}
      />
    </SectionCard>
  );
}
