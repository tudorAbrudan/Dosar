/**
 * Chat Threads service
 *
 * Gestionează conversațiile (threads) și mesajele lor în SQLite.
 * Fiecare thread are un nume editabil și un istoric complet de mesaje.
 */

import { db, generateId } from './db';

// ─── Tipuri ────────────────────────────────────────────────────────────────────

export interface ChatThread {
  id: string;
  name: string;
  lastMessage?: string;
  messageCount: number;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// ─── Threads ──────────────────────────────────────────────────────────────────

export async function getChatThreads(): Promise<ChatThread[]> {
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
    message_count: number;
    last_content: string | null;
  }>(`
    SELECT
      t.id,
      t.name,
      t.created_at,
      t.updated_at,
      COUNT(m.id) AS message_count,
      (SELECT content FROM chat_messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) AS last_content
    FROM chat_threads t
    LEFT JOIN chat_messages m ON m.thread_id = t.id
    GROUP BY t.id
    ORDER BY t.updated_at DESC
  `);

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    lastMessage: r.last_content ?? undefined,
    messageCount: r.message_count,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function createChatThread(name: string): Promise<ChatThread> {
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO chat_threads (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, name, now, now]
  );
  return { id, name, messageCount: 0, created_at: now, updated_at: now };
}

export async function renameChatThread(id: string, name: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync('UPDATE chat_threads SET name = ?, updated_at = ? WHERE id = ?', [
    name,
    now,
    id,
  ]);
}

export async function deleteChatThread(id: string): Promise<void> {
  await db.runAsync('DELETE FROM chat_messages WHERE thread_id = ?', [id]);
  await db.runAsync('DELETE FROM chat_threads WHERE id = ?', [id]);
}

// ─── Mesaje ───────────────────────────────────────────────────────────────────

export async function getThreadMessages(threadId: string): Promise<StoredMessage[]> {
  const rows = await db.getAllAsync<{
    id: string;
    thread_id: string;
    role: string;
    content: string;
    created_at: string;
  }>('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC', [threadId]);
  return rows.map(r => ({
    id: r.id,
    thread_id: r.thread_id,
    role: r.role as 'user' | 'assistant',
    content: r.content,
    created_at: r.created_at,
  }));
}

export async function saveMessage(
  threadId: string,
  role: 'user' | 'assistant',
  content: string
): Promise<StoredMessage> {
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    'INSERT INTO chat_messages (id, thread_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, threadId, role, content, now]
  );
  // Actualizăm updated_at pe thread
  await db.runAsync('UPDATE chat_threads SET updated_at = ? WHERE id = ?', [now, threadId]);
  return { id, thread_id: threadId, role, content, created_at: now };
}

export async function deleteMessage(messageId: string): Promise<void> {
  await db.runAsync('DELETE FROM chat_messages WHERE id = ?', [messageId]);
}

export async function clearThreadMessages(threadId: string): Promise<void> {
  await db.runAsync('DELETE FROM chat_messages WHERE thread_id = ?', [threadId]);
  const now = new Date().toISOString();
  await db.runAsync('UPDATE chat_threads SET updated_at = ? WHERE id = ?', [now, threadId]);
}
