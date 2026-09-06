/**
 * Contextul chat-ului medical.
 *
 * Regresii raportate pe device 2026-09-04:
 *  - „Ce grupă sanguină am?" → „nu găsesc", deși app-ul o AFIȘA în antet;
 *  - „Ultima analiză când am făcut-o?" → „nu găsesc", deși dosarul are analize;
 *  - „Ce nivel de fier am?" → „nu găsesc", deși există FERITINA în Timeline.
 *
 * Cauza comună: contextul se construia exclusiv din potriviri pe termeni. Profilul
 * dosarului lipsea, documentele intrau doar la potrivire FTS, iar observațiile
 * doar dacă numele lor conținea literal termenul din întrebare — „fier" nu se
 * regăsește în „FERITINA".
 */
import { buildContextStringForTest as buildContextString } from '@/services/medicalChat';

const empty = {
  observations: [],
  documentChunks: [],
  record: null,
  recentDocuments: [],
  latestPerParameter: [],
};

describe('buildContextString — profil dosar', () => {
  it('include grupa sanguină când e completată', () => {
    const out = buildContextString({
      ...empty,
      record: { blood_group: '0 pozitiv' } as never,
    });
    expect(out).toContain('PROFIL DOSAR');
    expect(out).toContain('0 pozitiv');
  });

  it('include alergiile și contactul de urgență', () => {
    const out = buildContextString({
      ...empty,
      record: {
        allergies: 'penicilină',
        emergency_contact_name: 'Ana',
        emergency_contact_phone: '0700',
      } as never,
    });
    expect(out).toContain('penicilină');
    expect(out).toContain('Ana');
  });

  it('nu emite secțiunea când profilul e gol', () => {
    expect(buildContextString({ ...empty, record: {} as never })).not.toContain('PROFIL DOSAR');
  });
});

describe('buildContextString — documente din dosar', () => {
  it('listează documentele cu dată, ca răspuns la „ultima analiză"', () => {
    const out = buildContextString({
      ...empty,
      recentDocuments: [
        { id: 'd1', label: 'Analize medicale', date: '2026-08-06' },
        { id: 'd2', label: 'Scrisoare medicală', date: '2026-05-19' },
      ],
    });
    expect(out).toContain('DOCUMENTE ÎN DOSAR');
    expect(out).toContain('[DOC:Analize medicale|d1]');
    expect(out).toContain('2026-08-06');
  });

  it('marchează explicit documentele fără dată', () => {
    const out = buildContextString({
      ...empty,
      recentDocuments: [{ id: 'd1', label: 'Rețetă', date: null }],
    });
    expect(out).toContain('fără dată');
  });

  it('contextul complet gol rămâne semnalat ca atare', () => {
    expect(buildContextString(empty)).toContain('Niciun context');
  });
});

describe('buildContextString — ultima valoare per parametru', () => {
  it('include parametrii chiar dacă întrebarea nu-i numește exact', () => {
    // Regresia „ce nivel de fier am?": termenul extras e „fier", dar observația
    // se numește „FERITINA" — potrivirea pe șir dădea zero rezultate.
    const out = buildContextString({
      ...empty,
      latestPerParameter: [
        {
          id: 'o1',
          name: 'FERITINA',
          value: '71.9',
          unit: 'ng/mL',
          ref_min: '30',
          ref_max: '400',
          observed_at: '2026-08-06',
        } as never,
      ],
    });
    expect(out).toContain('ULTIMA VALOARE PENTRU FIECARE ANALIZĂ');
    expect(out).toContain('FERITINA: 71.9 ng/mL');
    expect(out).toContain('interval 30-400');
    expect(out).toContain('[OBS:o1]');
  });

  it('tolerează valori sau unități lipsă fără să crape', () => {
    const out = buildContextString({
      ...empty,
      latestPerParameter: [{ id: 'o2', name: 'TSH', observed_at: null } as never],
    });
    expect(out).toContain('TSH');
    expect(out).toContain('dată necunoscută');
  });
});
