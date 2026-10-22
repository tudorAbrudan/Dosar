import Colors from '@/constants/Colors';
import { iconColors } from '@/theme/iconColors';
import { ALL_ENTITY_TYPES, ENTITY_TYPE_LABELS, ENTITY_TYPE_EMOJI } from '@/types';
import type { EntityType } from '@/types';
import { SectionCard } from './SectionCard';
import { InfoRow } from './InfoRow';

interface VizibilitateEntitatiSectionProps {
  visibleEntityTypes: EntityType[];
  scheme: 'light' | 'dark';
  onToggleEntityType: (type: EntityType) => void;
}

/** Ce tipuri de entități apar în aplicație. Pliabilă. */
export function VizibilitateEntitatiSection({
  visibleEntityTypes,
  scheme,
  onToggleEntityType,
}: VizibilitateEntitatiSectionProps) {
  const C = Colors[scheme];
  return (
    <SectionCard
      title="Entități active"
      scheme={scheme}
      collapsible
      description="Alege ce tipuri de entități să apară în aplicație. Entitățile dezactivate nu vor apărea în formulare sau liste."
    >
      {ALL_ENTITY_TYPES.map(entityType => {
        const isActive = visibleEntityTypes.includes(entityType);
        return (
          <InfoRow
            key={entityType}
            emoji={ENTITY_TYPE_EMOJI[entityType]}
            iconBg={isActive ? iconColors.primary.bg : C.border}
            iconColor={iconColors.primary.fg}
            label={ENTITY_TYPE_LABELS[entityType]}
            switchValue={isActive}
            onSwitchChange={() => onToggleEntityType(entityType)}
            scheme={scheme}
          />
        );
      })}
    </SectionCard>
  );
}
