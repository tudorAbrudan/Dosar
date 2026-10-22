import { iconColors } from '@/theme/iconColors';
import { SectionCard } from './SectionCard';
import { InfoRow } from './InfoRow';

interface SecuritateSectionProps {
  appLockEnabled: boolean;
  medicalAppLockEnabled: boolean;
  scheme: 'light' | 'dark';
  onToggle: (value: boolean) => void;
  onToggleMedicalLock: (value: boolean) => void;
}

const LOCK_HINT =
  'Dacă ai Face ID configurat pe telefon, poți debloca aplicația cu el chiar dacă uiți PIN-ul. ' +
  'Dacă ai uitat PIN-ul și nu ai Face ID, dezactivează blocarea din Setări iPhone → Parolă și ' +
  'Face ID → resetează datele aplicației.';

export function SecuritateSection({
  appLockEnabled,
  medicalAppLockEnabled,
  scheme,
  onToggle,
  onToggleMedicalLock,
}: SecuritateSectionProps) {
  return (
    <SectionCard title="Securitate" scheme={scheme} footer={appLockEnabled ? LOCK_HINT : undefined}>
      <InfoRow
        icon="lock-closed-outline"
        iconBg={iconColors.pink.bg}
        iconColor={iconColors.pink.fg}
        label="Blocare aplicație"
        sub="Face ID / Touch ID / PIN"
        switchValue={appLockEnabled}
        onSwitchChange={onToggle}
        scheme={scheme}
      />
      <InfoRow
        icon="medkit-outline"
        iconBg={iconColors.pink.bg}
        iconColor={iconColors.pink.fg}
        label="App Lock pentru dosare medicale"
        sub="Cere autentificare la deschiderea unui dosar medical, independent de App Lock-ul global. Timeout 5 minute."
        switchValue={medicalAppLockEnabled}
        onSwitchChange={onToggleMedicalLock}
        scheme={scheme}
      />
    </SectionCard>
  );
}
