/**
 * Modul „metaOnly": când OCR-ul on-device e deja bun, nu mai cerem AI-ului
 * secțiunea ===OCR===, deci răspunsul e JSON pur, iar transcrierea trebuie
 * păstrată din textul on-device (ocrFallback). Vezi optimizarea de cost AI.
 */
import { parseResponse } from '@/services/ocrLlmExtractor';

describe('parseResponse — mod metaOnly (JSON pur + fallback OCR on-device)', () => {
  const onDeviceOcr = 'Synevo Laborator\nHemoglobina: 14.5 g/dL';

  it('parsează JSON pur și păstrează transcrierea on-device ca ocr_text', () => {
    const raw = JSON.stringify({
      issue_date: '2024-03-15',
      expiry_date: null,
      note: 'Analize normale',
      metadata: { lab: 'Synevo' },
    });
    const result = parseResponse(raw, onDeviceOcr);
    expect(result.issue_date).toBe('2024-03-15');
    expect(result.expiry_date).toBeUndefined();
    expect(result.note).toBe('Analize normale');
    expect(result.metadata.lab).toBe('Synevo');
    expect(result.ocr_text).toBe(onDeviceOcr);
  });

  it('nu pierde ocr_text nici când JSON-ul e truncat', () => {
    const raw = '{"issue_date": "2024-03-15", "note": "Rezumat parti';
    const result = parseResponse(raw, onDeviceOcr);
    expect(result.issue_date).toBe('2024-03-15');
    expect(result.ocr_text).toBe(onDeviceOcr);
  });

  it('preferă transcrierea AI când răspunsul chiar conține secțiunea OCR', () => {
    const raw = [
      '===OCR===',
      '[Antet]',
      'Transcriere de la AI',
      '===META===',
      '{"issue_date": null, "expiry_date": "2027-01-01", "note": "n", "metadata": {}}',
    ].join('\n');
    const result = parseResponse(raw, onDeviceOcr);
    expect(result.ocr_text).toContain('Transcriere de la AI');
    expect(result.expiry_date).toBe('2027-01-01');
  });

  it('fără fallback și fără OCR în răspuns, ocr_text rămâne undefined', () => {
    const result = parseResponse('{"issue_date": null, "metadata": {}}');
    expect(result.ocr_text).toBeUndefined();
  });
});
