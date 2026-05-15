/**
 * Mapping `DocumentType → IoniconName` folosit pe ecranele Home, Documente,
 * Expirări. Singura sursă pentru iconițele de document.
 *
 * Notă: `DOC_ICON_BG` / `DOC_ICON_COLOR` rămân în `theme/docTypeColors.ts`.
 *
 * Pentru tipuri nou-adăugate care nu apar aici, fallback la `document-outline`
 * (handled la call-site cu `DOC_ICON[doc.type] ?? 'document-outline'`).
 */
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

import type { DocumentType } from '@/types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export const DOC_ICON: Record<DocumentType, IoniconName> = {
  buletin: 'id-card',
  pasaport: 'book',
  permis_auto: 'car',
  talon: 'document-text',
  carte_auto: 'document',
  rca: 'shield-checkmark',
  casco: 'shield-half',
  itp: 'checkmark-circle',
  vigneta: 'ribbon',
  act_proprietate: 'home',
  cadastru: 'map',
  factura: 'receipt',
  impozit_proprietate: 'cash-outline',
  card: 'card',
  garantie: 'ribbon-outline',
  bon_cumparaturi: 'receipt-outline',
  bon_parcare: 'car-outline',
  pad: 'home-outline',
  stingator_incendiu: 'flame-outline',
  abonament: 'repeat-outline',
  contract: 'document-text-outline',
  card_sanatate: 'medkit-outline',
  certificat_nastere: 'happy-outline',
  certificat_casatorie: 'heart-outline',
  certificat_botez: 'water-outline',
  vaccin_animal: 'fitness-outline',
  deparazitare: 'bug-outline',
  vizita_vet: 'paw-outline',
  bilet: 'ticket-outline',
  certificat_inregistrare: 'document-text-outline',
  autorizatie_activitate: 'shield-checkmark-outline',
  act_constitutiv: 'document-text-outline',
  certificat_tva: 'receipt-outline',
  asigurare_profesionala: 'shield-outline',
  asigurare_personala: 'shield-outline',
  diploma: 'school-outline',
  foaie_matricola: 'list-outline',
  certificat_absolvire: 'ribbon-outline',
  certificat_curs: 'trophy-outline',
  adeverinta_studii: 'document-text-outline',
  altul: 'document-outline',
  custom: 'document-outline',
};
