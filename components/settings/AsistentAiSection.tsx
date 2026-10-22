import { InfoRow } from './InfoRow';
import { SectionCard } from './SectionCard';
import { iconColors } from '@/theme/iconColors';

interface AsistentAiSectionProps {
  /** Cine răspunde și unde, ex. „Model local, pe telefon · Qwen 3.5 2B" (describeAiAnswerer). */
  answererLabel: string;
  aiMedicalAllowed: boolean;
  scheme: 'light' | 'dark';
  onOpenAiModal: () => void;
  onToggleAiMedical: (value: boolean) => void;
}

export function AsistentAiSection({
  answererLabel,
  aiMedicalAllowed,
  scheme,
  onOpenAiModal,
  onToggleAiMedical,
}: AsistentAiSectionProps) {
  return (
    <SectionCard title="Asistent AI" scheme={scheme}>
      <InfoRow
        icon="sparkles-outline"
        iconBg={iconColors.aiPurple.bg}
        iconColor={iconColors.aiPurple.fg}
        label="Unde rulează asistentul"
        sub={answererLabel}
        onPress={onOpenAiModal}
        scheme={scheme}
      />
      <InfoRow
        icon="medkit-outline"
        iconBg={iconColors.pink.bg}
        iconColor={iconColors.pink.fg}
        label="Asistent AI pe dosarele medicale"
        sub="Acordul se dă separat, în fiecare dosar medical (Art. 9 GDPR). Oprit: niciun dosar nu mai folosește AI — nici chat, nici extragere automată."
        switchValue={aiMedicalAllowed}
        onSwitchChange={onToggleAiMedical}
        scheme={scheme}
      />
    </SectionCard>
  );
}
