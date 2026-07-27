import { detectDocumentType } from '@/services/ocr';

// Regresie 2026-07: talonul real scrie „CERTIFICATUL DE ÎNMATRICULARE" (cu articol),
// dar regex-ul cerea `certificat de` lipit → talonul cădea pe „Altele" (mai ales pe
// model local, care n-are vision și lucrează doar pe textul OCR).
describe('detectDocumentType — talon', () => {
  it('detectează talonul din „certificatul de înmatriculare" (formă articulată)', () => {
    const ocr = 'ANEXA LA CERTIFICATUL DE ÎNMATRICULARE\nNr. C01018964J\nCJ-14-MXY';
    expect(detectDocumentType(ocr)).toBe('talon');
  });

  it('detectează și fără diacritice (î pierdut la OCR)', () => {
    expect(detectDocumentType('CERTIFICATUL DE INMATRICULARE')).toBe('talon');
  });

  it('detectează forma ne-articulată „certificat de înmatriculare"', () => {
    expect(detectDocumentType('Certificat de înmatriculare seria X')).toBe('talon');
  });

  it('detectează cuvântul colocvial „talon"', () => {
    expect(detectDocumentType('Talon auto Dacia Duster')).toBe('talon');
  });

  it('nu confundă talonul cu ITP deși conține „INSPECȚII TEHNICE PERIODICE"', () => {
    // Panoul-anexă al talonului listează inspecțiile tehnice (plural) — nu trebuie
    // să declanșeze tipul „itp" (care cere „inspecție tehnică", singular).
    const ocr =
      'CERTIFICATUL DE ÎNMATRICULARE\nINSPECȚII TEHNICE PERIODICE\nAUTOTURISM M1\n08.12.2024';
    expect(detectDocumentType(ocr)).toBe('talon');
  });

  it('întoarce null pe text fără semnale de tip', () => {
    expect(detectDocumentType('lorem ipsum dolor sit amet')).toBeNull();
  });
});
