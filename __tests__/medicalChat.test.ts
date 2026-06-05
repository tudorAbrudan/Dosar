/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Round-trip plaintext pentru medical_chat_messages (spec 2026-06-05).
 * sendMessage scrie `content` ca TEXT plaintext, nu ca BLOB criptat.
 *
 * Folosește better-sqlite3 in-memory cu schema reală din db.ts (același pattern
 * ca __tests__/medicalObservations.test.ts). AI + FTS sunt mock-uite ca testul
 * să fie determinist și fără rețea.
 */
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => {
    const { createTestDbInstance } = require('./helpers/testDb');
    return createTestDbInstance();
  },
}));

jest.mock('@/services/aiProvider', () => ({
  sendAiRequest: jest.fn(async () => 'Răspuns asistent fără citații.'),
}));

jest.mock('@/services/medicalFts', () => ({
  searchChunks: jest.fn(async () => []),
}));

import { applySchemaToTestDb } from './helpers/testDbSetup';
import type { TestDb } from './helpers/testDb';

let db: typeof import('@/services/db').db;
let testDb: TestDb;
let createThread: typeof import('@/services/medicalChat').createThread;
let sendMessage: typeof import('@/services/medicalChat').sendMessage;

beforeAll(() => {
  jest.resetModules();
  jest.isolateModules(() => {
    db = require('@/services/db').db as typeof db;
    testDb = db as unknown as TestDb;
    applySchemaToTestDb(testDb);
    const chat = require('@/services/medicalChat');
    createThread = chat.createThread;
    sendMessage = chat.sendMessage;
  });
});

beforeEach(() => {
  testDb._raw.pragma('foreign_keys = OFF');
  testDb._raw.exec('DELETE FROM medical_chat_messages');
  testDb._raw.exec('DELETE FROM medical_chat_threads');
  testDb._raw.exec('DELETE FROM medical_record');
  testDb._raw.exec('DELETE FROM persons');
  testDb._raw.pragma('foreign_keys = ON');
  // pre-cond: persoană + dosar 'r1'
  testDb._raw.exec(`
    INSERT INTO persons (id, name, created_at) VALUES ('p1', 'Ana', 't');
    INSERT INTO medical_record
      (id, person_id, name, ai_consent_at, ai_consent_version, encryption_key_ref,
       created_at, updated_at)
    VALUES ('r1', 'p1', 'Dosar test', 't', 1, 'plaintext-v2', 't', 't');
  `);
});

it('stores chat message content as readable plaintext', async () => {
  const thread = await createThread('r1', 'Test');
  await sendMessage({ threadId: thread.id, recordId: 'r1', question: 'Ce hemoglobină am?' });

  // Mesajul user e scris de codul nostru; citim direct coloana TEXT din DB.
  const rows = testDb._raw
    .prepare(
      'SELECT role, content FROM medical_chat_messages WHERE thread_id = ? ORDER BY created_at ASC'
    )
    .all(thread.id) as { role: string; content: string }[];

  const userRow = rows.find(r => r.role === 'user');
  expect(typeof userRow?.content).toBe('string');
  expect(userRow?.content).toBe('Ce hemoglobină am?');
});
