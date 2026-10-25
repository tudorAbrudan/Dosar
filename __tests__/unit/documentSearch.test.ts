/**
 * Căutarea din ecranul Documente: până la 2026-10 se uita doar în nume + notă,
 * deci „Allianz", un număr de înmatriculare sau seria unei polițe nu găseau
 * documentul, deși textul era salvat (OCR + câmpuri).
 */
import {
  buildSearchIndex,
  buildSnippet,
  matchesQuery,
  parseSearchQuery,
  type SearchSnippet,
} from '@/services/documentSearch';
import { getDocumentLabel, type Document } from '@/types';

function doc(partial: Partial<Document> & Pick<Document, 'id' | 'type'>): Document {
  return { main_orientation_locked: false, created_at: '2026-01-01', ...partial };
}

function search(docs: Document[], query: string, entityName: string | null = null) {
  const index = buildSearchIndex(docs, d => ({ label: getDocumentLabel(d, []), entityName }));
  const q = parseSearchQuery(query)!;
  return docs
    .filter(d => matchesQuery(index.get(d.id)!, q))
    .map(d => ({ id: d.id, snippet: buildSnippet(index.get(d.id)!, q) }));
}

const highlighted = (s: SearchSnippet | null) => s && s.text.slice(s.matchStart, s.matchEnd);

const rca = doc({
  id: 'rca1',
  type: 'rca',
  metadata: { insurer: 'Allianz-Țiriac', plate: 'B 123 ABC', policy_number: 'RO/25/V1/XY' },
  ocr_text: 'POLIȚĂ DE ASIGURARE RCA\nAsigurat: Popescu Ion\nVehicul: Dacia Logan',
});
const talon = doc({
  id: 'talon1',
  type: 'talon',
  ocr_text: 'CERTIFICAT DE ÎNMATRICULARE\nNr. înmatriculare: CJ 07 ABC',
});

describe('potrivire', () => {
  it('găsește textul OCR fără diacritice', () => {
    expect(search([rca, talon], 'inmatriculare').map(r => r.id)).toEqual(['talon1']);
  });

  it('găsește valorile din câmpuri (metadata)', () => {
    expect(search([rca, talon], 'allianz').map(r => r.id)).toEqual(['rca1']);
  });

  it('cere toți termenii, oriunde în document', () => {
    expect(search([rca, talon], 'rca allianz').map(r => r.id)).toEqual(['rca1']);
    expect(search([rca, talon], 'rca groupama')).toEqual([]);
  });

  it('potrivește numerele și fără spații sau punctuație', () => {
    expect(search([rca, talon], 'B123ABC').map(r => r.id)).toEqual(['rca1']);
    expect(search([rca, talon], 'ro25v1').map(r => r.id)).toEqual(['rca1']);
  });

  it('nu face potrivire compactă pe termeni scurți (ar prinde aproape orice)', () => {
    // „c.j" compact = „cj" — sub 4 caractere, deci doar potrivire exactă.
    expect(search([rca, talon], 'c.j')).toEqual([]);
  });

  it('găsește după numele entității', () => {
    expect(search([talon], 'dacia', 'Dacia Logan').map(r => r.id)).toEqual(['talon1']);
  });

  it('nu caută niciodată în notele private', () => {
    const card = doc({ id: 'c1', type: 'card', private_notes: 'PIN 4821' });
    expect(search([card], '4821')).toEqual([]);
  });

  it('la documentele medicale caută doar numele și nota, nu OCR-ul', () => {
    const analize = doc({
      id: 'm1',
      type: 'analize_medicale',
      note: 'Laborator Synevo',
      ocr_text: 'Hemoglobina 13.2 g/dL',
      metadata: { lab: 'Synevo' },
    });
    expect(search([analize], 'hemoglobina')).toEqual([]);
    expect(search([analize], 'synevo')).toEqual([{ id: 'm1', snippet: null }]);
  });
});

describe('fragment', () => {
  it('lipsește când potrivirea se vede deja în nume', () => {
    expect(search([rca], 'rca')[0].snippet).toBeNull();
  });

  it('arată câmpul cu eticheta lui', () => {
    const [hit] = search([rca], 'allianz');
    expect(hit.snippet?.text).toBe('Asigurator: Allianz-Țiriac');
    expect(highlighted(hit.snippet)).toBe('Allianz');
  });

  it('evidențiază textul original la potrivirea compactă', () => {
    expect(highlighted(search([rca], 'b123abc')[0].snippet)).toBe('B 123 ABC');
  });

  it('evidențiază textul original, cu diacritice', () => {
    expect(highlighted(search([talon], 'inmatriculare')[0].snippet)).toBe('ÎNMATRICULARE');
  });

  it('mapează corect pozițiile când diacriticele sunt descompuse', () => {
    // „ă" scris ca „a" + breve combinant: textul normalizat e mai scurt.
    const d = doc({ id: 'd1', type: 'contract', ocr_text: 'Locatar: Găman Mihai, str. Lungă' });
    expect(highlighted(search([d], 'mihai')[0].snippet)).toBe('Mihai');
  });

  it('taie textul lung la granița cuvintelor, cu „…"', () => {
    const long = doc({
      id: 'l1',
      type: 'contract',
      ocr_text: `${'cuvânt '.repeat(30)}Furnizor: ENEL Energie Muntenia ${'altceva '.repeat(30)}`,
    });
    const snippet = search([long], 'enel')[0].snippet!;
    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
    expect(snippet.text).not.toMatch(/…\S*\s{2}/);
    expect(highlighted(snippet)).toBe('ENEL');
  });

  it('nu arată niciodată fragment pentru documentele medicale', () => {
    const r = doc({ id: 'm2', type: 'reteta_medicala', note: 'Dr. Ionescu, Cardiologie' });
    expect(search([r], 'cardiologie')[0].snippet).toBeNull();
  });
});

describe('parseSearchQuery', () => {
  it('întoarce null pentru o căutare goală', () => {
    expect(parseSearchQuery('   ')).toBeNull();
  });
});
