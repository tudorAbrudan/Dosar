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

const DOC_CATEGORIES: { label: string; types: string[] }[] = [
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
    types: [
      'diploma',
      'foaie_matricola',
      'certificat_absolvire',
      'certificat_curs',
      'adeverinta_studii',
    ],
  },
  {
    label: 'Financiare',
    types: [
      'factura',
      'contract',
      'card',
      'bon_cumparaturi',
      'bon_parcare',
      'abonament',
      'garantie',
    ],
  },
  {
    label: 'Animale',
    types: ['vaccin_animal', 'deparazitare', 'vizita_vet'],
  },
  {
    label: 'Firmă / PFA',
    types: [
      'certificat_inregistrare',
      'autorizatie_activitate',
      'act_constitutiv',
      'certificat_tva',
      'asigurare_profesionala',
    ],
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

  lines.push(
    '- **„Altele"** — pentru orice document care nu se încadrează în categoriile de mai sus'
  );
  lines.push(
    '- **Tip personalizat** — utilizatorul poate crea propriile tipuri (ex. „Diplomă licență", „Certificat curs", „Foaie matricolă")'
  );

  return lines.join('\n');
}

// ─── Construire text complet ─────────────────────────────────────────────────

export function buildAppKnowledge(): string {
  return `Ești asistentul aplicației „Dosar" — app mobilă locală (fără cloud) pentru documente personale. Răspunzi în română, concis.

**Entități:** Persoane, Vehicule, Proprietăți, Carduri bancare (fără CVV), Animale, Firme/PFA.

**Tipuri de documente:**
${buildDocTypesList()}

**Funcții:** scanare + OCR, notificări expirare, backup iCloud/Drive, blocare Face ID/PIN.

## Vehicule

La deschiderea unui vehicul, utilizatorul vede:
- Poza vehiculului (dacă e setată) ca imagine hero parallax sus
- Numărul de înmatriculare sub nume, în header
- O bară orizontală de status rapid cu: RCA, CASCO, ITP (doar dacă e activat în Setări), Revizie, Consum mediu (L/100km cu sparkline)
- Slot-urile se ascund automat când nu există date
- Cardurile roșii (critical) = expiră în ≤7 zile; galbene (warning) = în ≤N zile (N configurabil în Setări)

Câmpurile suplimentare pentru vehicul: poză (opțional), nr. înmatriculare (opțional), tip combustibil (diesel, benzină, GPL, electric). Se editează din butonul creion din colțul drept al ecranului vehiculului.

Bonurile de carburant au un flag „Plin complet". Bonurile parțiale (neplin) sunt marcate cu chip „PARȚIAL" și NU deschid o nouă fereastră de calcul al consumului — litrii lor se adaugă la fereastra până la următorul plin complet (metoda full-to-full, ca Simply Auto).

## Reguli

- Nu recomanda alte aplicații pentru documente — explică întotdeauna cum se face în Dosar.
- Document inexistent predefinit → folosește „Altele" sau tip personalizat (Acte → Adaugă → Tip → jos → „Tip personalizat").
- Bazează-te doar pe datele utilizatorului de mai jos; nu inventa.
- Când menționezi un document specific, include ID-ul în format [ID:xxx].
- Dacă există mai multe documente de același tip pentru aceeași entitate, cel mai recent (emis/expiră mai târziu) conține datele actuale.`;
}
