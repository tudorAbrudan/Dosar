import type { ThemePreference } from '@/hooks/useThemeScheme';
import { SectionCard } from './SectionCard';
import { ChoiceChip, ChoiceChipRow } from './ChoiceChip';

interface AspectSectionProps {
  themePref: ThemePreference;
  scheme: 'light' | 'dark';
  onSelectPref: (pref: ThemePreference) => void;
}

const THEME_OPTIONS: [ThemePreference, string][] = [
  ['auto', 'Automat'],
  ['light', 'Clar'],
  ['dark', 'Întunecat'],
];

/** Secțiunea Aspect — tema aplicației (Automat / Clar / Întunecat). Pliabilă. */
export function AspectSection({ themePref, scheme, onSelectPref }: AspectSectionProps) {
  return (
    <SectionCard
      title="Aspect"
      scheme={scheme}
      collapsible
      description="Alege tema de culori a aplicației."
    >
      <ChoiceChipRow>
        {THEME_OPTIONS.map(([value, label]) => (
          <ChoiceChip
            key={value}
            label={label}
            selected={themePref === value}
            onPress={() => onSelectPref(value)}
            accessibilityLabel={`Temă ${label}`}
            scheme={scheme}
          />
        ))}
      </ChoiceChipRow>
    </SectionCard>
  );
}
