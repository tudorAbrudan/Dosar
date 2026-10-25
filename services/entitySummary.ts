/**
 * Fișa unei entități: pentru fiecare tip de document cu dată de expirare,
 * starea celui mai recent (valabil / expiră curând / expirat), plus documentele
 * esențiale care lipsesc.
 *
 * Aceeași fișă alimentează cardul „Situație" de pe ecranul entității și
 * secțiunea „Situație documente" din contextul asistentului. Zilele rămase se
 * calculează aici, nu de model: modelele mici greșesc aritmetica pe date (același
 * motiv ca vârsta precalculată din chatbot.ts).
 */
import {
  DOCUMENT_TYPE_LABELS,
  MEDICAL_DOC_TYPES,
  NO_EXPIRY_DOC_TYPES,
  getDocumentLabel,
} from '@/types';
import type { CustomDocumentType, Document, DocumentType, EntityType } from '@/types';
import { EXPIRING_SOON_DAYS, daysUntilExpiry } from './expiry';
import { ESSENTIAL_DOC_TYPES } from './homeAlerts';
import { resolveItpExpiry } from './vehicleStatus';

export type EntityDocStatus = 'expired' | 'expiring' | 'missing' | 'ok';

export interface EntitySummaryItem {
  /** Unic în fișă: tipul documentului, sau `custom:<id>` pentru tipurile personalizate. */
  key: string;
  type: DocumentType;
  /** Ce afișăm pe rând (la ITP-ul luat de pe talon: „ITP", nu „Talon"). */
  label: string;
  status: EntityDocStatus;
  expiryIso?: string;
  daysRemaining?: number;
  docId?: string;
  /** Eticheta documentului-sursă, pentru citarea lui de către asistent. */
  docLabel?: string;
}

interface BuildArgs {
  entityType: EntityType;
  /** Documentele legate de entitate (coloana legacy sau `entity_links`). */
  documents: Document[];
  visibleDocTypes: readonly DocumentType[];
  customTypes: CustomDocumentType[];
  today?: Date;
}

/**
 * Data unui bilet e ziua evenimentului, nu o valabilitate: un zbor de anul
 * trecut ar apărea altfel „expirat", cu roșu, în fișa persoanei.
 */
const EVENT_DOC_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>(['bilet']);

const STATUS_RANK: Record<EntityDocStatus, number> = {
  expired: 0,
  expiring: 1,
  missing: 2,
  ok: 3,
};

function statusOf(days: number): EntityDocStatus {
  if (days < 0) return 'expired';
  if (days <= EXPIRING_SOON_DAYS) return 'expiring';
  return 'ok';
}

export function buildEntitySummary({
  entityType,
  documents,
  visibleDocTypes,
  customTypes,
  today = new Date(),
}: BuildArgs): EntitySummaryItem[] {
  const docs = documents.filter(d => !MEDICAL_DOC_TYPES.has(d.type));
  const isVehicle = entityType === 'vehicle';

  // Cel mai recent document cu dată, per tip. Talonul ține în `expiry_date`
  // scadența ITP, nu o expirare a lui — intră doar prin ITP-ul vehiculului.
  const latest = new Map<string, { doc: Document; iso: string; label: string }>();
  for (const doc of docs) {
    if (!doc.expiry_date || doc.type === 'talon') continue;
    if (NO_EXPIRY_DOC_TYPES.has(doc.type) || EVENT_DOC_TYPES.has(doc.type)) continue;
    if (isVehicle && doc.type === 'itp') continue;
    if (Number.isNaN(new Date(doc.expiry_date).getTime())) continue;
    const key = doc.type === 'custom' ? `custom:${doc.custom_type_id ?? ''}` : doc.type;
    const prev = latest.get(key);
    if (!prev || doc.expiry_date > prev.iso) {
      latest.set(key, {
        doc,
        iso: doc.expiry_date,
        label: getDocumentLabel(doc, customTypes),
      });
    }
  }
  // ITP: documentul ITP SAU ștampila de pe talon — aceeași rezolvare ca bara
  // de status a vehiculului și sugestiile din Home.
  if (isVehicle) {
    const itp = resolveItpExpiry(docs);
    if (itp) latest.set('itp', { doc: itp.doc, iso: itp.iso, label: DOCUMENT_TYPE_LABELS.itp });
  }

  const items: EntitySummaryItem[] = [];
  for (const [key, { doc, iso, label }] of latest) {
    const days = daysUntilExpiry(iso, today);
    items.push({
      key,
      type: key === 'itp' ? 'itp' : doc.type,
      label,
      status: statusOf(days),
      expiryIso: iso,
      daysRemaining: days,
      docId: doc.id,
      docLabel: getDocumentLabel(doc, customTypes),
    });
  }

  for (const type of ESSENTIAL_DOC_TYPES[entityType] ?? []) {
    if (!visibleDocTypes.includes(type)) continue;
    const present =
      isVehicle && type === 'itp'
        ? resolveItpExpiry(docs) !== undefined
        : docs.some(d => d.type === type);
    if (!present) {
      items.push({ key: type, type, label: DOCUMENT_TYPE_LABELS[type], status: 'missing' });
    }
  }

  return items.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.daysRemaining ?? 0) - (b.daysRemaining ?? 0)
  );
}

function formatDateRo(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}.${m}.${y}` : iso;
}

/** „1 zi", „5 zile", „23 de zile", „101 zile" (regula lui „de" în română). */
function daysRo(n: number): string {
  if (n === 1) return '1 zi';
  const lastTwo = n % 100;
  return `${n} ${lastTwo === 0 || lastTwo >= 20 ? 'de zile' : 'zile'}`;
}

/** Ce afișează rândul din cardul „Situație" (formulări fără acord de gen). */
export function describeSummaryItem(item: EntitySummaryItem): string {
  if (item.status === 'missing') return 'Lipsește';
  const days = item.daysRemaining ?? 0;
  const date = formatDateRo(item.expiryIso ?? '');
  if (item.status === 'expired') {
    if (days === -1) return 'A expirat ieri';
    return -days <= 60 ? `A expirat acum ${daysRo(-days)}` : `A expirat pe ${date}`;
  }
  if (item.status === 'expiring') {
    if (days === 0) return 'Expiră azi';
    if (days === 1) return 'Expiră mâine';
    return `Expiră în ${daysRo(days)}`;
  }
  return `Expiră pe ${date}`;
}

/**
 * O linie de fișă pentru contextul asistentului, sau `null` dacă entitatea n-are
 * nimic de raportat. Datele rămân ISO (ca în lista de documente din context),
 * zilele sunt deja calculate.
 */
export function formatEntitySummaryForAI(items: EntitySummaryItem[]): string | null {
  if (items.length === 0) return null;
  return items
    .map(item => {
      if (item.status === 'missing')
        return `${item.label}: lipsește (niciun document în aplicație)`;
      const days = item.daysRemaining ?? 0;
      const when =
        days < 0 ? `acum ${daysRo(-days)}` : days === 0 ? 'azi' : `peste ${daysRo(days)}`;
      const state =
        item.status === 'expired'
          ? `EXPIRAT pe ${item.expiryIso}`
          : item.status === 'expiring'
            ? `expiră curând, pe ${item.expiryIso}`
            : `valabil, expiră pe ${item.expiryIso}`;
      const source = item.docId ? ` [DOC:${item.docLabel ?? item.label}|${item.docId}]` : '';
      return `${item.label}: ${state} (${when})${source}`;
    })
    .join('; ');
}

export interface SituationEntity {
  id: string;
  type: EntityType;
  /** Tag-ul de citare din context, ex. `[ENT:Ion|person|<id>]`. */
  tag: string;
  /** Documentele entității, deja trecute prin `getDocumentsForAI`. */
  documents: Document[];
}

interface SituationArgs {
  entities: SituationEntity[];
  visibleDocTypes: readonly DocumentType[];
  customTypes: CustomDocumentType[];
  /** Plafonul modelului local; fără el, la multe entități, fișa ar împinge documentele afară. */
  maxChars?: number;
  today?: Date;
}

/**
 * Secțiunea „Situație documente" din contextul asistentului: câte o linie per
 * entitate care are ceva de raportat. `chars` = cât a consumat din plafon.
 */
export function buildSituationSection({
  entities,
  visibleDocTypes,
  customTypes,
  maxChars = Number.POSITIVE_INFINITY,
  today,
}: SituationArgs): { text: string | null; chars: number } {
  const lines: string[] = [];
  let chars = 0;
  let omitted = 0;
  for (const entity of entities) {
    const summary = formatEntitySummaryForAI(
      buildEntitySummary({
        entityType: entity.type,
        documents: entity.documents,
        visibleDocTypes,
        customTypes,
        today,
      })
    );
    if (!summary) continue;
    const line = `- ${entity.tag}: ${summary}`;
    if (chars + line.length > maxChars) {
      omitted++;
      continue;
    }
    chars += line.length;
    lines.push(line);
  }
  if (lines.length === 0) return { text: null, chars: 0 };
  if (omitted > 0) {
    lines.push(`(încă ${omitted} entități nu încap aici — pentru ele folosește o @mențiune)`);
  }
  return {
    text: [
      'Situație documente (calculată de aplicație azi — pentru valabilitate și expirări folosește-o pe ea, nu recalcula zilele):',
      ...lines,
    ].join('\n'),
    chars,
  };
}
