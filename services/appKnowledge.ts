/**
 * appKnowledge.ts — Sursă unică de adevăr despre funcționalitățile aplicației Dosar.
 *
 * Folosit în:
 * - chatbot.ts       → system prompt pentru asistentul AI
 *
 * IMPORTANT: Când adaugi funcționalități noi în aplicație, actualizează ACEST fișier.
 * Lista de tipuri de documente e generată automat din DOCUMENT_TYPE_LABELS (types/index.ts).
 * Funcționalitățile și entitățile sunt descrise manual mai jos — actualizează-le la nevoie.
 */

import { DOCUMENT_TYPE_LABELS } from '@/types';

// ─── Grupare tipuri de documente pe categorie ────────────────────────────────

const DOC_CATEGORIES: Array<{ label: string; types: string[] }> = [
  {
    label: 'Identitate',
    types: ['buletin', 'pasaport', 'permis_auto'],
  },
  {
    label: 'Vehicule',
    types: ['talon', 'carte_auto', 'rca', 'casco', 'itp', 'vigneta'],
  },
  {
    label: 'Proprietăți',
    types: ['act_proprietate', 'cadastru', 'pad', 'impozit_proprietate'],
  },
  {
    label: 'Medicale',
    types: ['reteta_medicala', 'analize_medicale'],
  },
  {
    label: 'Studii',
    types: ['diploma', 'foaie_matricola', 'certificat_absolvire', 'certificat_curs', 'adeverinta_studii'],
  },
  {
    label: 'Financiare',
    types: ['factura', 'contract', 'card', 'bon_cumparaturi', 'bon_parcare', 'abonament', 'garantie'],
  },
  {
    label: 'Animale',
    types: ['vaccin_animal', 'deparazitare', 'vizita_vet'],
  },
  {
    label: 'Firmă / PFA',
    types: ['certificat_inregistrare', 'autorizatie_activitate', 'act_constitutiv', 'certificat_tva', 'asigurare_profesionala'],
  },
  {
    label: 'Altele',
    types: ['bilet', 'stingator_incendiu', 'altul'],
  },
];

function buildDocTypesList(): string {
  const lines: string[] = [];

  for (const cat of DOC_CATEGORIES) {
    const labels = cat.types
      .map(t => DOCUMENT_TYPE_LABELS[t as keyof typeof DOCUMENT_TYPE_LABELS])
      .filter(Boolean)
      .join(', ');
    if (labels) lines.push(`- ${cat.label}: ${labels}`);
  }

  lines.push('- **„Altele"** — pentru orice document care nu se încadrează în categoriile de mai sus');
  lines.push('- **Tip personalizat** — utilizatorul poate crea propriile tipuri (ex. „Diplomă licență", „Certificat curs", „Foaie matricolă")');

  return lines.join('\n');
}

// ─── Construire text complet ─────────────────────────────────────────────────

export function buildAppKnowledge(): string {
  return `Ești asistentul aplicației „Dosar" — aplicație mobilă pentru gestionarea documentelor personale. Răspunzi în română, concis și util.

## Ce este aplicația Dosar

Dosar este o aplicație locală (fără cloud, fără login) pentru stocarea și organizarea documentelor personale. Toate datele rămân pe telefonul utilizatorului.

**Entități** — grupează documentele după proprietar/subiect:
- Persoane (membri de familie, etc.)
- Vehicule (mașini, motociclete)
- Proprietăți (apartamente, case, terenuri)
- Carduri bancare (fără CVV — doar ultimele 4 cifre, expirare, nickname)
- Animale de companie
- Firme / PFA

**Documente** — orice document poate fi salvat ca poză sau PDF, legat de o entitate:
${buildDocTypesList()}

**Funcții principale:**
- Scanare documente cu camera + OCR automat (extrage text și date din poze)
- Notificări de expirare (configurabil cu X zile înainte, funcționează și când app e închisă)
- Backup complet în iCloud (iOS) / Google Drive (Android) și restore
- Blocare cu Face ID / Touch ID / PIN
- Asistent AI (acesta) pentru căutare și întrebări despre documente

## Reguli obligatorii

- **NICIODATĂ nu recomanda alte aplicații** pentru a stoca sau gestiona documente. Dacă utilizatorul întreabă unde poate salva ceva, răspunde întotdeauna cum se face în Dosar.
- Când un tip de document nu există predefinit, explică că poate folosi **„Altele"** sau poate crea un **tip personalizat** (Acte → Adaugă document → Tip → derulează jos → „Tip personalizat").
- Bazează-te pe datele utilizatorului de mai jos; nu inventa date care nu există.
- Când menționezi un document specific din datele utilizatorului, include ID-ul în format [ID:xxx] ca să poată fi deschis direct.`;
}
