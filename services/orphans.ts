import { db } from './db';
import { DOC_PRIMARY_ENTITY, DOCUMENT_TYPE_LABELS } from '@/types';
import type { DocumentType, EntityType } from '@/types';

export type OrphanGroupKey =
  | 'doc_no_entity'
  | 'doc_custom_no_type'
  | 'card_no_expiry'
  | 'person_no_contact';

export type OrphanFixKind = 'document_edit' | 'entity_detail';

export interface OrphanItem {
  id: string;
  label: string;
  hint: string;
  fixKind: OrphanFixKind;
  fixId: string;
}

export interface OrphanGroup {
  key: OrphanGroupKey;
  title: string;
  description: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  items: OrphanItem[];
}

const ENTITY_LABEL_FOR_HINT: Record<EntityType, string> = {
  person: 'persoană',
  vehicle: 'mașină',
  property: 'proprietate',
  card: 'card',
  animal: 'animal',
  company: 'firmă',
};

// Tipuri care pot exista valid fără entitate atașată: tipuri generice
// (altul / custom) și bonuri/bilete care de obicei sunt păstrate ca documente
// libere. Orice altceva fără entitate apare în lista „de completat".
const TYPES_VALID_WITHOUT_ENTITY = new Set<DocumentType>([
  'altul',
  'custom',
  'bilet',
  'bon_cumparaturi',
  'bon_parcare',
]);

// Sugestii de atașament pentru tipuri ambigue (cu mai multe entități posibile).
// Folosit când DOC_PRIMARY_ENTITY nu definește una unică.
const HINT_FOR_AMBIGUOUS_TYPE: Partial<Record<DocumentType, string>> = {
  factura: 'Atașează la proprietate, card sau firmă',
  contract: 'Atașează la o entitate',
  garantie: 'Atașează la persoană sau proprietate',
  abonament: 'Atașează la persoană, proprietate sau card',
  card: 'Atașează la un card',
  stingator_incendiu: 'Atașează la mașină sau proprietate',
};

interface DocOrphanRow {
  id: string;
  type: string;
  custom_type_id: string | null;
  issue_date: string | null;
  created_at: string;
  has_links: number;
  any_legacy: number;
}

async function findDocumentsWithoutEntity(): Promise<OrphanItem[]> {
  const rows = await db.getAllAsync<DocOrphanRow>(
    `SELECT
       d.id,
       d.type,
       d.custom_type_id,
       d.issue_date,
       d.created_at,
       (SELECT COUNT(*) FROM document_entities de WHERE de.document_id = d.id) AS has_links,
       CASE
         WHEN d.person_id IS NOT NULL OR d.property_id IS NOT NULL OR d.vehicle_id IS NOT NULL
           OR d.card_id IS NOT NULL OR d.animal_id IS NOT NULL OR d.company_id IS NOT NULL
         THEN 1 ELSE 0
       END AS any_legacy
     FROM documents d
     ORDER BY d.created_at DESC`
  );

  const items: OrphanItem[] = [];
  for (const r of rows) {
    if (r.has_links > 0 || r.any_legacy === 1) continue;
    const docType = r.type as DocumentType;
    if (TYPES_VALID_WITHOUT_ENTITY.has(docType)) continue;

    const typeLabel = DOCUMENT_TYPE_LABELS[docType] ?? docType;
    const dateStr = r.issue_date ?? r.created_at.slice(0, 10);

    let hint: string;
    const primaryEntity = DOC_PRIMARY_ENTITY[docType];
    if (primaryEntity) {
      hint = `Atașează la ${ENTITY_LABEL_FOR_HINT[primaryEntity]}`;
    } else {
      hint = HINT_FOR_AMBIGUOUS_TYPE[docType] ?? 'Atașează la o entitate';
    }

    items.push({
      id: r.id,
      label: `${typeLabel} · ${dateStr}`,
      hint,
      fixKind: 'document_edit',
      fixId: r.id,
    });
  }
  return items;
}

interface DocCustomRow {
  id: string;
  issue_date: string | null;
  created_at: string;
}

async function findCustomDocsWithoutType(): Promise<OrphanItem[]> {
  const rows = await db.getAllAsync<DocCustomRow>(
    `SELECT id, issue_date, created_at FROM documents
     WHERE type = 'custom' AND (custom_type_id IS NULL OR custom_type_id = '')
     ORDER BY created_at DESC`
  );
  return rows.map(r => {
    const dateStr = r.issue_date ?? r.created_at.slice(0, 10);
    return {
      id: r.id,
      label: `Tip personalizat · ${dateStr}`,
      hint: 'Alege tipul documentului',
      fixKind: 'document_edit',
      fixId: r.id,
    };
  });
}

interface CardRow {
  id: string;
  nickname: string;
  last4: string;
}

async function findCardsWithoutExpiry(): Promise<OrphanItem[]> {
  const rows = await db.getAllAsync<CardRow>(
    `SELECT id, nickname, last4 FROM cards
     WHERE expiry IS NULL OR expiry = ''
     ORDER BY created_at DESC`
  );
  return rows.map(r => ({
    id: r.id,
    label: `${r.nickname || 'Card'} ····${r.last4}`,
    hint: 'Adaugă data expirării',
    fixKind: 'entity_detail',
    fixId: r.id,
  }));
}

interface PersonRow {
  id: string;
  name: string;
}

async function findPersonsWithoutContact(): Promise<OrphanItem[]> {
  const rows = await db.getAllAsync<PersonRow>(
    `SELECT id, name FROM persons
     WHERE (phone IS NULL OR phone = '')
       AND (email IS NULL OR email = '')
     ORDER BY created_at DESC`
  );
  return rows.map(r => ({
    id: r.id,
    label: r.name,
    hint: 'Adaugă telefon sau email',
    fixKind: 'entity_detail',
    fixId: r.id,
  }));
}

function pluralRo(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

export async function getOrphans(): Promise<OrphanGroup[]> {
  const [docsNoEntity, customNoType, cardsNoExpiry, personsNoContact] = await Promise.all([
    findDocumentsWithoutEntity(),
    findCustomDocsWithoutType(),
    findCardsWithoutExpiry(),
    findPersonsWithoutContact(),
  ]);

  const groups: OrphanGroup[] = [];

  if (docsNoEntity.length > 0) {
    groups.push({
      key: 'doc_no_entity',
      title: 'Documente fără entitate',
      description: `${docsNoEntity.length} ${pluralRo(docsNoEntity.length, 'document neatașat la o entitate', 'documente neatașate la o entitate')}`,
      icon: 'document-text-outline',
      iconBg: '#E3F2FD',
      iconColor: '#1565C0',
      items: docsNoEntity,
    });
  }

  if (customNoType.length > 0) {
    groups.push({
      key: 'doc_custom_no_type',
      title: 'Tip personalizat nesetat',
      description: `${customNoType.length} ${pluralRo(customNoType.length, 'document fără numele tipului', 'documente fără numele tipului')}`,
      icon: 'pricetag-outline',
      iconBg: '#FFF8E1',
      iconColor: '#F57F17',
      items: customNoType,
    });
  }

  if (cardsNoExpiry.length > 0) {
    groups.push({
      key: 'card_no_expiry',
      title: 'Carduri fără expirare',
      description: `${cardsNoExpiry.length} ${pluralRo(cardsNoExpiry.length, 'card fără data expirării', 'carduri fără data expirării')}`,
      icon: 'card-outline',
      iconBg: '#F3E5F5',
      iconColor: '#7B1FA2',
      items: cardsNoExpiry,
    });
  }

  if (personsNoContact.length > 0) {
    groups.push({
      key: 'person_no_contact',
      title: 'Persoane fără contact',
      description: `${personsNoContact.length} ${pluralRo(personsNoContact.length, 'persoană fără telefon și email', 'persoane fără telefon și email')}`,
      icon: 'person-outline',
      iconBg: '#E8F5E9',
      iconColor: '#388E3C',
      items: personsNoContact,
    });
  }

  return groups;
}
