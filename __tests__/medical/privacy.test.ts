/**
 * @jest-environment node
 *
 * Privacy interceptor: assert că `private_notes` și alte câmpuri sensibile
 * NU ajung niciodată în payload-ul AI prin pipeline-ul medical.
 *
 * Strategy:
 * 1. Mock pe `getDocumentById` să returneze un Document cu private_notes populat
 *    cu un marker text unic (TEST_LEAK_8765).
 * 2. Mock pe sendAiRequest să captureze toate mesajele.
 * 3. Rulează extractor și asertă că markerul NU apare în niciun mesaj.
 */

import * as aiProvider from '@/services/aiProvider';
import { extractFromDocument } from '@/services/medicalExtractor';
import { getDocumentById } from '@/services/documents';
import { getMedicalRecordByPersonId } from '@/services/medicalRecord';
import { resetMedicalMasterKeyForTests } from '@/services/medicalCrypto';

const LEAK_MARKER = 'TEST_LEAK_8765';

// SecureStore stateful (necesar pentru ensureMedicalMasterKey)
const secureStore: Record<string, string> = {};

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (k: string) => secureStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    secureStore[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    delete secureStore[k];
  }),
}));

jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    getRandomBytes: (n: number) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) out[i] = (counter * 31 + i * 7 + Date.now()) & 0xff;
      counter += 13;
      return out;
    },
  };
});

// Mock pdfOcr — întoarce un OCR „curat" (fără markerul).
jest.mock('@/services/pdfOcr', () => ({
  extractTextFromPdfViaOcr: jest
    .fn()
    .mockResolvedValue('HDL colesterol 55 mg/dL\nGlicemie 90 mg/dL'),
}));
jest.mock('@/services/ocr', () => ({
  extractText: jest.fn().mockResolvedValue({ text: 'HDL colesterol 55 mg/dL' }),
}));

// Mock documents service — controlăm Document returnat
jest.mock('@/services/documents', () => {
  const real = jest.requireActual('@/services/documents');
  return {
    ...real,
    getDocumentById: jest.fn(),
    // Reuse real sanitizeDocumentForAI ca să nu mascăm bug-uri din implementare.
    sanitizeDocumentForAI: real.sanitizeDocumentForAI,
  };
});

// Mock medicalRecord — întoarce un dosar cu consent activ
jest.mock('@/services/medicalRecord', () => ({
  getMedicalRecordByPersonId: jest.fn(),
}));

// Mock medicalObservations + medicalFts — vrem să capturăm sendAiRequest, nu să
// efectiv inserăm.
jest.mock('@/services/medicalObservations', () => ({
  insertObservation: jest.fn().mockResolvedValue({ id: 'obs1', needs_review: false }),
  deleteObservationsBySourceDocument: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/services/medicalFts', () => ({
  insertChunks: jest.fn().mockResolvedValue(undefined),
  deleteChunksBySource: jest.fn().mockResolvedValue(undefined),
  chunkText: jest.fn().mockReturnValue([]),
  buildObservationChunk: jest.fn().mockReturnValue(''),
}));

// Mock settings — toggle AI medical activ
jest.mock('@/services/settings', () => ({
  getAiMedicalAllowed: jest.fn().mockResolvedValue(true),
}));

const mockedGetDoc = getDocumentById as jest.MockedFunction<typeof getDocumentById>;
const mockedGetRec = getMedicalRecordByPersonId as jest.MockedFunction<
  typeof getMedicalRecordByPersonId
>;

describe('privacy: private_notes never reaches medical AI pipeline', () => {
  beforeEach(async () => {
    for (const k of Object.keys(secureStore)) delete secureStore[k];
    await resetMedicalMasterKeyForTests();
    jest.clearAllMocks();
  });

  it('extractFromDocument does NOT include private_notes in sendAiRequest payload', async () => {
    mockedGetDoc.mockResolvedValue({
      id: 'doc1',
      type: 'analize_medicale',
      person_id: 'p1',
      file_path: 'documents/doc1.pdf',
      issue_date: '2024-03-12',
      created_at: new Date().toISOString(),
      main_orientation_locked: false,
      note: 'notiță publică',
      // Markerul critic — NU TREBUIE să apară în niciun mesaj AI.
      private_notes: `${LEAK_MARKER} cvv 123 pin 9876 parolă_secretă`,
    });
    mockedGetRec.mockResolvedValue({
      id: 'rec1',
      person_id: 'p1',
      name: 'Dosar',
      ai_consent_at: new Date().toISOString(),
      ai_consent_version: 1,
      encryption_key_ref: 'medical_master_key_v1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const spy = jest.spyOn(aiProvider, 'sendAiRequest').mockResolvedValue('{"observations":[]}');

    await extractFromDocument('doc1');

    expect(spy).toHaveBeenCalled();
    // Verifică în toate apelurile + toate mesajele
    for (const call of spy.mock.calls) {
      const messages = call[0];
      for (const m of messages) {
        const content = String(m.content);
        expect(content).not.toContain(LEAK_MARKER);
        expect(content).not.toContain('cvv 123');
        expect(content).not.toContain('parolă_secretă');
      }
    }
  });

  it('extractFromDocument INCLUDES OCR text in payload (sanity check)', async () => {
    mockedGetDoc.mockResolvedValue({
      id: 'doc2',
      type: 'analize_medicale',
      person_id: 'p1',
      file_path: 'documents/doc2.pdf',
      issue_date: '2024-01-01',
      created_at: new Date().toISOString(),
      main_orientation_locked: false,
      private_notes: LEAK_MARKER,
    });
    mockedGetRec.mockResolvedValue({
      id: 'rec1',
      person_id: 'p1',
      name: 'Dosar',
      ai_consent_at: new Date().toISOString(),
      ai_consent_version: 1,
      encryption_key_ref: 'medical_master_key_v1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const spy = jest.spyOn(aiProvider, 'sendAiRequest').mockResolvedValue('{"observations":[]}');

    await extractFromDocument('doc2');

    // Confirmă că pipeline-ul chiar trimite OCR-ul — nu blocăm totul accidental.
    const allContent = spy.mock.calls.flatMap(c => c[0].map(m => String(m.content))).join('\n');
    expect(allContent).toContain('HDL colesterol');
    expect(allContent).not.toContain(LEAK_MARKER);
  });

  it('skips extraction when AI medical globally disabled', async () => {
    // Re-mock settings ca să dezactiveze AI medical global
    const settings = require('@/services/settings');
    settings.getAiMedicalAllowed.mockResolvedValueOnce(false);

    mockedGetDoc.mockResolvedValue({
      id: 'doc3',
      type: 'analize_medicale',
      person_id: 'p1',
      file_path: 'documents/doc3.pdf',
      issue_date: '2024-01-01',
      created_at: new Date().toISOString(),
      main_orientation_locked: false,
      private_notes: LEAK_MARKER,
    });
    mockedGetRec.mockResolvedValue({
      id: 'rec1',
      person_id: 'p1',
      name: 'Dosar',
      ai_consent_at: new Date().toISOString(),
      ai_consent_version: 1,
      encryption_key_ref: 'medical_master_key_v1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const spy = jest.spyOn(aiProvider, 'sendAiRequest').mockResolvedValue('{"observations":[]}');

    const result = await extractFromDocument('doc3');
    expect(result.status).toBe('no_consent');
    expect(spy).not.toHaveBeenCalled();
  });
});
