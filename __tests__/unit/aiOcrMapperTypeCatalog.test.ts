import { MAPPER_TYPE_CATALOG } from '@/services/aiOcrMapper';
import { MEDICAL_DOC_TYPES } from '@/types';

describe('MAPPER_TYPE_CATALOG — auto-analiza cunoaște toate tipurile', () => {
  it('include fiecare tip medical (auto-clasificarea nu mai cade pe „altul")', () => {
    // Bug: mapOcrWithAi nu avea tipurile medicale în vocabular → buletin analize
    // Synevo era clasat „altul", deși classifyDocument îl nimerea. Catalogul comun
    // (din aiTypeRegistry) acum acoperă mapper-ul ca pe classifyDocument.
    for (const t of MEDICAL_DOC_TYPES) {
      expect(MAPPER_TYPE_CATALOG).toContain(`"${t}"`);
    }
  });

  it('include și tipuri non-medicale uzuale (catalog complet, nu doar medical)', () => {
    expect(MAPPER_TYPE_CATALOG).toContain('"rca"');
    expect(MAPPER_TYPE_CATALOG).toContain('"factura"');
    expect(MAPPER_TYPE_CATALOG).toContain('"talon"');
  });

  it('conține descrierile registry-ului (sursă unică, nu o listă goală de id-uri)', () => {
    expect(MAPPER_TYPE_CATALOG).toMatch(/Buletin de analiz/i);
  });
});
