/**
 * appKnowledge pe intenție + citarea sursei impusă în cod.
 *
 * Promptul fix era ~5300 de tokeni (manualul complet al aplicației) la FIECARE
 * întrebare. Regulile efective ajungeau sub 1% din text și modelele mici nu le
 * mai respectau. Măsurat 2026-09-04.
 */
import { buildAppKnowledge } from '@/services/appKnowledge';
import { appendSourceIfUnambiguous } from '@/services/chatbot';

describe('buildAppKnowledge — secțiuni la cerere', () => {
  it('fără întrebare întoarce manualul complet (compatibil cu apelul vechi)', () => {
    expect(buildAppKnowledge().length).toBeGreaterThan(10000);
  });

  it('o întrebare simplă primește un prompt mult mai mic', () => {
    const full = buildAppKnowledge().length;
    const scoped = buildAppKnowledge('Ce varsta are Silvia?').length;
    expect(scoped).toBeLessThan(full / 3);
  });

  it('include secțiunea relevantă subiectului', () => {
    expect(buildAppKnowledge('Cum fac backup?')).toContain('iCloud');
    expect(buildAppKnowledge('Cand expira ITP-ul?')).toContain('ITP');
  });

  it('EXCLUDE secțiunile irelevante', () => {
    // Manualul de mentenanță auto n-are ce căuta la o întrebare despre vârstă.
    const scoped = buildAppKnowledge('Ce varsta are Silvia?');
    expect(scoped).not.toContain('distribuție');
    expect(scoped).not.toContain('Dosar medical');
  });

  it('păstrează MEREU nucleul și regulile', () => {
    for (const q of ['salut', 'Ce varsta are Silvia?', 'Cum fac backup?']) {
      const k = buildAppKnowledge(q);
      expect(k).toContain('Dosar');
      expect(k).toContain('## Reguli');
      expect(k).toContain('nu inventa');
    }
  });

  it('funcționează fără diacritice', () => {
    expect(buildAppKnowledge('cum fac backup')).toContain('iCloud');
  });
});

describe('appendSourceIfUnambiguous', () => {
  const one = new Map([['abc-123', 'Buletin']]);
  const two = new Map([
    ['abc-123', 'Buletin'],
    ['def-456', 'Pașaport'],
  ]);

  it('adaugă sursa când un singur document a fost în context', () => {
    const out = appendSourceIfUnambiguous('Silvia are 40 de ani.', one);
    expect(out).toContain('Sursa: [DOC:Buletin|abc-123]');
  });

  it('NU inventează sursa când sunt mai multe documente', () => {
    // O atribuire greșită e mai rea decât una lipsă — userul ar avea încredere.
    const out = appendSourceIfUnambiguous('Silvia are 40 de ani.', two);
    expect(out).not.toContain('Sursa:');
  });

  it('nu dublează sursa dacă modelul a citat deja', () => {
    const reply = 'Silvia are 40 de ani.\n\nSursa: [DOC:Buletin|abc-123]';
    expect(appendSourceIfUnambiguous(reply, one)).toBe(reply);
  });

  it('nu atinge un răspuns gol', () => {
    expect(appendSourceIfUnambiguous('   ', one)).toBe('   ');
  });

  it('nu face nimic când niciun document n-a fost în context', () => {
    const out = appendSourceIfUnambiguous('Nu am găsit documentul.', new Map());
    expect(out).not.toContain('Sursa:');
  });
});
