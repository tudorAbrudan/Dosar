/**
 * Generator pentru alertele contextuale „SUGESTII" din HomeScreen.
 *
 * Sugestiile sunt formate dinamic în funcție de entitățile fără documente
 * esențiale (vehicul fără talon/RCA/ITP, persoană fără buletin), filtrate
 * prin tipurile de document vizibile (setări → vizibilitate).
 */
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import { iconColors } from '@/theme/iconColors';
import type { Document, DocumentType } from '@/types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export interface SmartAlert {
  id: string;
  message: string;
  icon: IoniconName;
  iconBg: string;
  iconColor: string;
  navigate: { vehicle_id?: string; person_id?: string; type: DocumentType };
  actionLabel: string;
}

interface AlertCheck {
  docType: DocumentType;
  message: (entityName: string) => string;
  icon: IoniconName;
  palette: { bg: string; fg: string };
}

const VEHICLE_CHECKS: AlertCheck[] = [
  {
    docType: 'talon',
    message: name => `${name} nu are talon`,
    icon: 'document-text-outline',
    palette: iconColors.teal,
  },
  {
    docType: 'rca',
    message: name => `${name} nu are RCA`,
    icon: 'shield-outline',
    palette: iconColors.pink,
  },
  {
    docType: 'itp',
    message: name => `${name} nu are ITP`,
    icon: 'checkmark-circle-outline',
    palette: iconColors.deepPurple,
  },
];

const PERSON_CHECKS: AlertCheck[] = [
  {
    docType: 'buletin',
    message: name => `${name} nu are buletin`,
    icon: 'id-card-outline',
    palette: iconColors.info,
  },
];

const MAX_ALERTS = 3;

export function buildHomeAlerts(
  documents: Document[],
  vehicles: { id: string; name: string }[],
  persons: { id: string; name: string }[],
  visibleDocTypes: DocumentType[]
): SmartAlert[] {
  const alerts: SmartAlert[] = [];

  for (const check of VEHICLE_CHECKS) {
    if (!visibleDocTypes.includes(check.docType)) continue;
    for (const v of vehicles) {
      const has = documents.some(d => d.vehicle_id === v.id && d.type === check.docType);
      if (has) continue;
      alerts.push({
        id: `no-${check.docType}-${v.id}`,
        message: check.message(v.name),
        icon: check.icon,
        iconBg: check.palette.bg,
        iconColor: check.palette.fg,
        navigate: { vehicle_id: v.id, type: check.docType },
        actionLabel: 'Adaugă',
      });
    }
  }

  for (const check of PERSON_CHECKS) {
    if (!visibleDocTypes.includes(check.docType)) continue;
    for (const p of persons) {
      const has = documents.some(d => d.person_id === p.id && d.type === check.docType);
      if (has) continue;
      alerts.push({
        id: `no-${check.docType}-${p.id}`,
        message: check.message(p.name),
        icon: check.icon,
        iconBg: check.palette.bg,
        iconColor: check.palette.fg,
        navigate: { person_id: p.id, type: check.docType },
        actionLabel: 'Adaugă',
      });
    }
  }

  return alerts.slice(0, MAX_ALERTS);
}
