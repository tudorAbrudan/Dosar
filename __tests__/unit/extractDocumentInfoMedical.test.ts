import { extractDocumentInfo } from '@/services/ocr';
import { extractFieldsForType } from '@/services/ocrExtractors';

// Text OCR reconstruit dintr-un buletin de analize Synevo real (PDF digital).
// Conține: CNP (→ data nașterii 01.04.1984), data recoltării / rezultat (04.10.2017).
// Bug istoric: `issue_date` (data emiterii) prelua data nașterii derivată din CNP,
// pentru că fallback-ul excludea doar `mrz.dob`, nu și `birth_date` din CNP.
const SYNEVO_TEXT = `Synevo Romania SRL
Site: www.synevo.ro; Cod doc: F01-PG-15 v2.1
Buletin analize medicale
Nume pacient:
CNP:
Varsta: 33 ani 6 luni
Sex:
1840401125909
Prenume pacient:
Abrudan
Tudor Vasile
Data recoltarii:
04/10/2017
7004543006
Data inregistrarii:
Numar cerere:
Denumire Rezultat UM Interval de referinta
M
Cod de bare: 1700370008
Recoltat: *Internal
Data nasterii: 01/04/1984
04/10/2017 08:10
Data rezultat:
Punct de recoltare: *CJ - Receptie Marasti
Contract: FFS Contract
04/10/2017 11:13
Hematologie
Grup sanguin OAB O
Pagina 1 din 2 Tiparit la: 6/4/2026 7:04:54PM`;

describe('extractDocumentInfo — buletin analize medicale (Synevo)', () => {
  const info = extractDocumentInfo(SYNEVO_TEXT);

  it('derivă corect data nașterii din CNP', () => {
    expect(info.birth_date).toBe('1984-04-01');
  });

  it('NU pune data nașterii ca data emiterii (issue_date)', () => {
    expect(info.issue_date).not.toBe('1984-04-01');
    expect(info.issue_date).not.toBe(info.birth_date);
  });

  it('extrage data recoltării/rezultatului ca issue_date', () => {
    expect(info.issue_date).toBe('2017-10-04');
  });
});

describe('rezoluție issue_date end-to-end (ca în add.tsx) pentru analize_medicale', () => {
  it('alege data documentului, nu data nașterii', () => {
    const fields = extractFieldsForType('analize_medicale', SYNEVO_TEXT);
    const info = extractDocumentInfo(SYNEVO_TEXT);
    const resolved = fields.issue_date ?? info.issue_date;
    expect(resolved).toBe('2017-10-04');
    expect(resolved).not.toBe('1984-04-01');
  });
});

// Al doilea buletin Synevo real (cererea 7008285518, recoltare 13.11.2024) —
// cazul exact din screenshot unde UI arăta „Data emisiune: 1984-04-01".
const SYNEVO_TEXT_2 = `Synevo Romania SRL
Buletin analize medicale
Nume pacient:
CNP:
Varsta: 40 ani 7 luni
Sex:
1840401125909
Prenume pacient:
Abrudan
TUDOR-VASILE
Data recoltarii:
13/11/2024
7008285518
Data inregistrarii:
Numar cerere:
Denumire Rezultat UM Interval de referinta
M
Cod de bare: 9000391067
Recoltat: Internal
Data nasterii: 01/04/1984
13/11/2024 10:19
Data rezultat:
Punct de recoltare: CJ - Receptie Marasti 1
Contract: FFS BDP MODULE
13/11/2024 14:10
Biochimie
Fier seric (sideremie) 128 µg/dL 33 - 193
Pagina 1 din 5 Tiparit la: 6/4/2026 7:06:36PM`;

describe('extractDocumentInfo — al doilea buletin Synevo (screenshot)', () => {
  const info = extractDocumentInfo(SYNEVO_TEXT_2);

  it('data nașterii rămâne 1984-04-01 (din CNP)', () => {
    expect(info.birth_date).toBe('1984-04-01');
  });

  it('issue_date = data recoltării 2024-11-13, nu data nașterii', () => {
    expect(info.issue_date).toBe('2024-11-13');
    expect(info.issue_date).not.toBe('1984-04-01');
  });
});

// ─── REGRESIE: acte de la ALTE instituții nu sunt afectate ───────────────────
// Cele două modificări (keyword-uri medicale + excluderea datei nașterii din
// fallback-ul issue) nu trebuie să schimbe extracția pe documente non-medicale.

describe('acte de la alte instituții — issue_date neschimbat', () => {
  it('carte de identitate (SPCLEP): „Eliberat la" rămâne data emiterii', () => {
    const ciText = `ROMANIA
CARTE DE IDENTITATE
Nume: ABRUDAN
Prenume: TUDOR VASILE
CNP 1840401125909
Eliberat la 12.05.2018 de SPCLEP Cluj
Valabila pana la 01.04.2028`;
    const info = extractDocumentInfo(ciText);
    expect(info.birth_date).toBe('1984-04-01');
    expect(info.issue_date).toBe('2018-05-12'); // din „Eliberat la", nu data nașterii
    expect(info.expiry_date).toBe('2028-04-01');
  });

  it('factură utilități (alt emitent): „Data emiterii" rămâne corectă', () => {
    const facturaText = `ENEL ENERGIE MUNTENIA
Factura nr. 123456789
Data emiterii: 15.01.2023
Data scadentei: 10.02.2023
Total de plata: 215,40 lei`;
    const info = extractDocumentInfo(facturaText);
    expect(info.issue_date).toBe('2023-01-15');
  });

  it('document cu CNP ȘI dată emitere reală: păstrează emiterea, nu o confundă cu nașterea', () => {
    // Excluderea datei nașterii din fallback NU trebuie să arunce o dată de
    // emitere legitimă atunci când documentul conține și un CNP.
    const certText = `CERTIFICAT
Nume: ABRUDAN TUDOR VASILE
CNP 1840401125909
Data emiterii: 20.06.2022
Valabil pana la: 20.06.2027`;
    const info = extractDocumentInfo(certText);
    expect(info.birth_date).toBe('1984-04-01');
    expect(info.issue_date).toBe('2022-06-20');
    expect(info.expiry_date).toBe('2027-06-20');
  });
});
