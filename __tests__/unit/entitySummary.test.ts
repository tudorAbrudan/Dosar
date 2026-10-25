/**
 * Fișa entității: cardul „Situație" de pe ecranul entității și secțiunea
 * „Situație documente" din contextul asistentului.
 */
import {
  buildEntitySummary,
  buildSituationSection,
  describeSummaryItem,
  formatEntitySummaryForAI,
  type EntitySummaryItem,
} from '@/services/entitySummary';
import { STANDARD_DOC_TYPES, type Document, type DocumentType } from '@/types';

const today = new Date(2026, 9, 25); // 2026-10-25, miezul nopții local

function doc(partial: Partial<Document> & Pick<Document, 'id' | 'type'>): Document {
  return { main_orientation_locked: false, created_at: '2026-01-01', ...partial };
}

function summary(
  entityType: 'person' | 'vehicle' | 'property',
  documents: Document[],
  visibleDocTypes: readonly DocumentType[] = STANDARD_DOC_TYPES
): EntitySummaryItem[] {
  return buildEntitySummary({ entityType, documents, visibleDocTypes, customTypes: [], today });
}

describe('buildEntitySummary', () => {
  it('ordonează după urgență: expirat, expiră curând, lipsește, valabil', () => {
    const items = summary('person', [
      doc({ id: 'b', type: 'pasaport', expiry_date: '2030-03-12' }),
      doc({ id: 'p', type: 'permis_auto', expiry_date: '2026-11-04' }),
      doc({ id: 'a', type: 'asigurare_personala', expiry_date: '2026-09-01' }),
    ]);
    expect(items.map(i => [i.label, i.status])).toEqual([
      ['Asigurare personală', 'expired'],
      ['Permis auto', 'expiring'],
      ['Buletin', 'missing'],
      ['Pașaport', 'ok'],
    ]);
    expect(items[1].daysRemaining).toBe(10);
  });

  it('nu spune „lipsește" pentru un tip ascuns din Setări', () => {
    const items = summary('person', [], ['pasaport']);
    expect(items).toEqual([]);
  });

  it('păstrează doar cel mai recent document de același tip', () => {
    const items = summary('property', [
      doc({ id: 'old', type: 'pad', expiry_date: '2025-05-01' }),
      doc({ id: 'new', type: 'pad', expiry_date: '2027-05-01' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ docId: 'new', status: 'ok' });
  });

  it('ia ITP-ul de pe ștampila talonului, ca bara de status a vehiculului', () => {
    const talon = doc({ id: 't', type: 'talon', metadata: { itp_expiry_date: '15.11.2026' } });
    const items = summary('vehicle', [talon], ['talon', 'itp']);
    expect(items).toEqual([
      expect.objectContaining({ key: 'itp', label: 'ITP', docId: 't', status: 'expiring' }),
    ]);
  });

  it('exclude documentele medicale, biletele și tipurile fără expirare', () => {
    const items = summary(
      'person',
      [
        doc({ id: 'r', type: 'reteta_medicala', expiry_date: '2026-10-30' }),
        doc({ id: 'z', type: 'bilet', expiry_date: '2025-08-01' }),
        doc({ id: 'f', type: 'factura', expiry_date: '2026-10-20' }),
      ],
      []
    );
    expect(items).toEqual([]);
  });
});

describe('describeSummaryItem', () => {
  const item = (status: EntitySummaryItem['status'], daysRemaining?: number) =>
    ({
      key: 'x',
      type: 'pasaport',
      label: 'Pașaport',
      status,
      daysRemaining,
      expiryIso: '2030-03-12',
    }) as EntitySummaryItem;

  it('formulează zilele corect în română', () => {
    expect(describeSummaryItem(item('expiring', 5))).toBe('Expiră în 5 zile');
    expect(describeSummaryItem(item('expiring', 23))).toBe('Expiră în 23 de zile');
    expect(describeSummaryItem(item('expiring', 1))).toBe('Expiră mâine');
    expect(describeSummaryItem(item('expiring', 0))).toBe('Expiră azi');
    expect(describeSummaryItem(item('expired', -1))).toBe('A expirat ieri');
    expect(describeSummaryItem(item('expired', -20))).toBe('A expirat acum 20 de zile');
    expect(describeSummaryItem(item('expired', -400))).toBe('A expirat pe 12.03.2030');
    expect(describeSummaryItem(item('ok', 1234))).toBe('Expiră pe 12.03.2030');
    expect(describeSummaryItem(item('missing'))).toBe('Lipsește');
  });
});

describe('formatEntitySummaryForAI', () => {
  it('dă zilele calculate și documentul-sursă, ca asistentul să nu recalculeze', () => {
    const items = summary('person', [
      doc({ id: 'p1', type: 'pasaport', expiry_date: '2026-11-04' }),
    ]);
    expect(formatEntitySummaryForAI(items)).toBe(
      'Pașaport: expiră curând, pe 2026-11-04 (peste 10 zile) [DOC:Pașaport|p1]; ' +
        'Buletin: lipsește (niciun document în aplicație)'
    );
  });

  it('întoarce null când entitatea n-are nimic de raportat', () => {
    expect(formatEntitySummaryForAI([])).toBeNull();
  });
});

describe('buildSituationSection', () => {
  const person = (id: string, name: string, documents: Document[]) => ({
    id,
    type: 'person' as const,
    tag: `[ENT:${name}|person|${id}]`,
    documents,
  });
  const ana = person('ana', 'Ana', [doc({ id: 'b1', type: 'buletin', expiry_date: '2030-01-01' })]);
  const ion = person('ion', 'Ion', [doc({ id: 'b2', type: 'buletin', expiry_date: '2026-10-20' })]);

  it('scrie câte o linie per entitate, cu tag-ul de citare', () => {
    const { text } = buildSituationSection({
      entities: [ana, ion],
      visibleDocTypes: ['buletin'],
      customTypes: [],
      today,
    });
    expect(text?.split('\n')).toEqual([
      expect.stringMatching(/^Situație documente/),
      '- [ENT:Ana|person|ana]: Buletin: valabil, expiră pe 2030-01-01 (peste 1164 de zile) [DOC:Buletin|b1]',
      '- [ENT:Ion|person|ion]: Buletin: EXPIRAT pe 2026-10-20 (acum 5 zile) [DOC:Buletin|b2]',
    ]);
  });

  it('respectă plafonul de caractere și spune câte entități au rămas pe dinafară', () => {
    const full = buildSituationSection({
      entities: [ana],
      visibleDocTypes: ['buletin'],
      customTypes: [],
      today,
    });
    const capped = buildSituationSection({
      entities: [ana, ion],
      visibleDocTypes: ['buletin'],
      customTypes: [],
      maxChars: full.chars,
      today,
    });
    expect(capped.chars).toBeLessThanOrEqual(full.chars);
    expect(capped.text).toContain('[ENT:Ana|person|ana]');
    expect(capped.text).not.toContain('[ENT:Ion|person|ion]');
    expect(capped.text).toContain('încă 1 entități nu încap');
  });

  it('nu emite nimic pentru entități fără nimic de raportat', () => {
    const empty = person('x', 'X', []);
    expect(
      buildSituationSection({ entities: [empty], visibleDocTypes: [], customTypes: [], today })
    ).toEqual({ text: null, chars: 0 });
  });
});
