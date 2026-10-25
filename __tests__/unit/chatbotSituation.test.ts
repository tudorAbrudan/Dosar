/**
 * „Situație documente" în contextul asistentului: fișa fiecărei entități, cu
 * zilele deja calculate. Testul trece prin `sendMessage` (AI-ul e mock-uit) și
 * citește promptul de sistem trimis — verifică integrarea din `buildContext`
 * și selecția după @mențiune. Plafonul de caractere al modelului local e testat
 * direct în `entitySummary.test.ts` (calea locală face `import()` dinamic, pe
 * care Jest din proiect nu-l rulează).
 */
import { sendMessage } from '@/services/chatbot';
import type { Document, Person } from '@/types';

const mockSend = jest.fn(async (_messages: { role: string; content: string }[]) => 'ok');
let mockPersons: Person[] = [];
let mockDocs: Document[] = [];

jest.mock('@/services/aiProvider', () => ({
  getAiConfig: async () => ({ type: 'remote' }),
  sendAiRequest: (messages: { role: string; content: string }[]) => mockSend(messages),
}));
jest.mock('@/services/entities', () => ({
  getPersons: async () => mockPersons,
  getProperties: async () => [],
  getVehicles: async () => [],
  getCards: async () => [],
  getAnimals: async () => [],
  getCompanies: async () => [],
}));
jest.mock('@/services/documents', () => ({ getDocumentsForAI: async () => mockDocs }));
jest.mock('@/services/customTypes', () => ({ getCustomTypes: async () => [] }));
jest.mock('@/services/settings', () => ({
  getVisibleDocTypes: async () => ['buletin', 'pasaport'],
}));

function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function person(id: string, name: string): Person {
  return { id, name, createdAt: '2026-01-01' };
}

function pasaport(id: string, personId: string, days: number): Document {
  return {
    id,
    type: 'pasaport',
    expiry_date: isoInDays(days),
    person_id: personId,
    main_orientation_locked: false,
    created_at: '2026-01-01',
  };
}

async function systemPromptFor(question: string): Promise<string> {
  mockSend.mockClear();
  await sendMessage(question, []);
  return mockSend.mock.calls[0][0][0].content;
}

function situationLines(prompt: string): string[] {
  const start = prompt.indexOf('Situație documente');
  expect(start).toBeGreaterThanOrEqual(0);
  return prompt
    .slice(start)
    .split('\n')
    .slice(1)
    .filter(l => l.startsWith('- [ENT:'));
}

beforeEach(() => {
  mockPersons = [person('p-ana', 'Ana'), person('p-ion', 'Ion')];
  mockDocs = [pasaport('d-ana', 'p-ana', 10)];
});

it('dă fișa fiecărei persoane, cu zilele calculate și documentul-sursă', async () => {
  const lines = situationLines(await systemPromptFor('ce acte are familia?'));
  expect(lines).toEqual([
    `- [ENT:Ana|person|p-ana]: Pașaport: expiră curând, pe ${isoInDays(10)} (peste 10 zile) [DOC:Pașaport|d-ana]; Buletin: lipsește (niciun document în aplicație)`,
    // Pașaportul nu e document esențial: lipsa lui nu se raportează.
    '- [ENT:Ion|person|p-ion]: Buletin: lipsește (niciun document în aplicație)',
  ]);
});

it('cu @mențiune, păstrează doar fișa entității menționate', async () => {
  const lines = situationLines(
    await systemPromptFor('[Context mențiuni: Ion (ID: p-ion)]\nce acte are?')
  );
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatch(/^- \[ENT:Ion\|person\|p-ion\]/);
});
