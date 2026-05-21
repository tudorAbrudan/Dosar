/**
 * Chat scoped pe un dosar medical, cu RAG hibrid (FTS5 + structured lookup)
 * și prompt strict anti-halucinație.
 *
 * Conținutul mesajelor e criptat AES-GCM cu AAD = medical_record.id.
 *
 * Reguli enforced de prompt:
 * - Nu interpretare clinică.
 * - Nu informații out-of-context.
 * - La fiecare valoare/citat: tag `[OBS:id]` sau `[DOC:label|id]`.
 *
 * Sanitization: `private_notes` niciodată în context (vezi
 * `.claude/rules/ai-privacy.md`). FTS5 chunks pentru documente NU includ
 * private_notes — `medicalExtractor.extractFromDocument` lucrează pe
 * `sanitizeDocumentForAI(doc)`.
 */
import { db, generateId } from './db';
import { encryptField, decryptFieldOrNull } from './medicalCrypto';
import { analyzeQuery, normalizeName, buildFtsMatchExpression } from './medicalQueryAnalysis';
import { searchChunks, type FtsHit } from './medicalFts';
import { listObservationsByRecord } from './medicalObservations';
import { getDocumentById } from './documents';
import { sendAiRequest } from './aiProvider';
import { emit } from './events';
import { DOCUMENT_TYPE_LABELS } from '@/types';
import type {
  MedicalChatThread,
  MedicalChatMessage,
  MedicalChatRole,
  MedicalChatCitation,
  MedicalObservation,
  DocumentType,
} from '@/types';

// ── Threads CRUD ─────────────────────────────────────────────────────────────

interface ThreadRow {
  id: string;
  medical_record_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

function rowToThread(r: ThreadRow): MedicalChatThread {
  return {
    id: r.id,
    medical_record_id: r.medical_record_id,
    title: r.title,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function createThread(
  recordId: string,
  title: string = 'Conversație'
): Promise<MedicalChatThread> {
  const id = generateId();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO medical_chat_threads(id, medical_record_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [id, recordId, title, now, now]
  );
  emit('entities:changed');
  const row = await db.getFirstAsync<ThreadRow>('SELECT * FROM medical_chat_threads WHERE id = ?', [
    id,
  ]);
  if (!row) throw new Error('Eroare la crearea conversației.');
  return rowToThread(row);
}

export async function listThreads(recordId: string): Promise<MedicalChatThread[]> {
  const rows = await db.getAllAsync<ThreadRow>(
    'SELECT * FROM medical_chat_threads WHERE medical_record_id = ? ORDER BY updated_at DESC',
    [recordId]
  );
  return rows.map(rowToThread);
}

export async function getThread(id: string): Promise<MedicalChatThread | null> {
  const row = await db.getFirstAsync<ThreadRow>('SELECT * FROM medical_chat_threads WHERE id = ?', [
    id,
  ]);
  return row ? rowToThread(row) : null;
}

export async function deleteThread(id: string): Promise<void> {
  await db.runAsync('DELETE FROM medical_chat_threads WHERE id = ?', [id]);
  emit('entities:changed');
}

export async function renameThread(id: string, title: string): Promise<void> {
  const now = new Date().toISOString();
  await db.runAsync('UPDATE medical_chat_threads SET title = ?, updated_at = ? WHERE id = ?', [
    title,
    now,
    id,
  ]);
  emit('entities:changed');
}

// ── Messages ─────────────────────────────────────────────────────────────────

interface MessageRow {
  id: string;
  thread_id: string;
  role: string;
  content_enc: Uint8Array;
  citations_json: string | null;
  created_at: string;
}

function toBytes(blob: Uint8Array | ArrayBuffer | null | undefined): Uint8Array | null {
  if (!blob) return null;
  if (blob instanceof Uint8Array) return blob;
  return new Uint8Array(blob);
}

function parseCitations(json: string | null): MedicalChatCitation[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((c): c is MedicalChatCitation => {
      if (typeof c !== 'object' || c === null) return false;
      const obj = c as Record<string, unknown>;
      if (obj.type === 'observation') return typeof obj.id === 'string';
      if (obj.type === 'document')
        return typeof obj.id === 'string' && typeof obj.label === 'string';
      return false;
    });
  } catch {
    return [];
  }
}

export async function listMessages(threadId: string): Promise<MedicalChatMessage[]> {
  const t = await db.getFirstAsync<{ medical_record_id: string }>(
    'SELECT medical_record_id FROM medical_chat_threads WHERE id = ?',
    [threadId]
  );
  if (!t) return [];
  const rows = await db.getAllAsync<MessageRow>(
    'SELECT * FROM medical_chat_messages WHERE thread_id = ? ORDER BY created_at ASC',
    [threadId]
  );
  const out: MedicalChatMessage[] = [];
  for (const r of rows) {
    const content =
      (await decryptFieldOrNull(toBytes(r.content_enc), t.medical_record_id)) ??
      '[mesaj indisponibil]';
    out.push({
      id: r.id,
      thread_id: r.thread_id,
      role: r.role as MedicalChatRole,
      content,
      citations: parseCitations(r.citations_json),
      created_at: r.created_at,
    });
  }
  return out;
}

interface InsertMessageArgs {
  thread_id: string;
  recordId: string;
  role: MedicalChatRole;
  content: string;
  citations: MedicalChatCitation[];
}

async function insertMessage(args: InsertMessageArgs): Promise<MedicalChatMessage> {
  const id = generateId();
  const now = new Date().toISOString();
  const enc = await encryptField(args.content, args.recordId);
  await db.runAsync(
    `INSERT INTO medical_chat_messages(id, thread_id, role, content_enc, citations_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, args.thread_id, args.role, enc, JSON.stringify(args.citations), now]
  );
  await db.runAsync('UPDATE medical_chat_threads SET updated_at = ? WHERE id = ?', [
    now,
    args.thread_id,
  ]);
  return {
    id,
    thread_id: args.thread_id,
    role: args.role,
    content: args.content,
    citations: args.citations,
    created_at: now,
  };
}

// ── Retrieval hibrid ─────────────────────────────────────────────────────────

const CONTEXT_CHAR_CAP = 6000;
const HISTORY_TURNS = 6;

export interface RetrievedDocChunk {
  documentId: string;
  label: string;
  observedAt: string | null;
  text: string;
}

export interface RetrievedContext {
  observations: MedicalObservation[];
  documentChunks: RetrievedDocChunk[];
}

function docLabelFromType(type: DocumentType): string {
  return DOCUMENT_TYPE_LABELS[type] ?? type;
}

export async function retrieveContext(recordId: string, query: string): Promise<RetrievedContext> {
  const a = analyzeQuery(query);

  // Set A: structured lookup pe observații decriptate
  const allObs = await listObservationsByRecord(recordId);
  const normTerms = a.searchTerms.map(t => normalizeName(t));
  const matched = allObs.filter(o => {
    const n = normalizeName(o.name);
    if (normTerms.length === 0) return true;
    return normTerms.some(t => n.includes(t));
  });
  const filtered = matched.filter(o => {
    if (!o.observed_at) return true;
    if (a.from && o.observed_at < a.from) return false;
    if (a.to && o.observed_at > a.to) return false;
    return true;
  });

  // Heuristic prune după intent
  let observations: MedicalObservation[] = filtered;
  if (a.intent === 'trend') {
    // 2 obs/lună max, păstrăm cele mai vechi + recente per lună
    const byMonth = new Map<string, MedicalObservation[]>();
    for (const o of filtered) {
      const key = (o.observed_at ?? 'unknown').slice(0, 7);
      const arr = byMonth.get(key);
      if (arr) arr.push(o);
      else byMonth.set(key, [o]);
    }
    observations = Array.from(byMonth.values()).flatMap(arr => arr.slice(0, 2));
  } else if (a.intent === 'latest') {
    observations = filtered.slice(0, 5);
  } else {
    observations = filtered.slice(0, 30);
  }

  // Set B: FTS5 search
  let ftsHits: FtsHit[] = [];
  const ftsExpr = buildFtsMatchExpression(a.searchTerms);
  const fallbackExpr = !ftsExpr
    ? query
        .split(/\s+/)
        .filter(w => w.length > 2)
        .map(w => `${w.toLowerCase()}*`)
        .join(' OR ')
    : null;
  const finalExpr = ftsExpr ?? (fallbackExpr && fallbackExpr.length > 0 ? fallbackExpr : null);
  if (finalExpr) {
    // Filtrarea temporală (from/to) nu se aplică la FTS — medical_fts nu stochează
    // observed_at. Post-retrieval, documentele sunt filtrate prin documents.issue_date
    // dacă e nevoie (spec §7.2). Toate hits-urile FTS sunt documente (observațiile
    // nu sunt indexate — spec §6.5).
    ftsHits = await searchChunks({
      recordId,
      query: finalExpr,
      limit: 20,
    });
  }

  const docChunks: RetrievedDocChunk[] = [];
  let charCount = 0;
  for (const h of ftsHits) {
    if (charCount + h.chunk_text.length > CONTEXT_CHAR_CAP) break;
    const doc = await getDocumentById(h.document_id);
    if (!doc) continue;
    // Filtrare temporală post-retrieval dacă userul a specificat interval.
    if (a.from && doc.issue_date && doc.issue_date < a.from) continue;
    if (a.to && doc.issue_date && doc.issue_date > a.to) continue;
    docChunks.push({
      documentId: doc.id,
      label: docLabelFromType(doc.type),
      observedAt: doc.issue_date ?? null,
      text: h.chunk_text,
    });
    charCount += h.chunk_text.length;
  }

  return { observations, documentChunks: docChunks };
}

// ── Prompt + sendMessage ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ești asistent pentru dosarul medical al utilizatorului în aplicația Dosar Medical.

REGULI ABSOLUTE:
1. Răspunzi DOAR pe baza datelor din "Context dosar" de mai jos.
2. NU oferi diagnostic, NU interpretezi clinic ("aceasta înseamnă că...", "ar trebui să...", "este normal/anormal" — interzis).
3. Dacă întrebarea cere ceva ce nu e în context, răspunzi exact:
   "Nu găsesc această informație în dosarul tău medical."
4. La fiecare valoare/dată/medicament menționat, adaugi citation:
   - pentru observații extrase: [OBS:id]
   - pentru documente: [DOC:label|id]
5. Dacă userul cere interpretare clinică, redirectezi:
   "Pentru interpretare clinică, consultă medicul tău. Pot doar să-ți arăt ce scrie în documentele tale."
6. NU folosi cunoștințe medicale generale. Doar ce e în context.
7. Răspunde în română.`;

function buildContextString(ctx: RetrievedContext): string {
  const lines: string[] = [];
  if (ctx.observations.length > 0) {
    lines.push('=== OBSERVAȚII STRUCTURATE ===');
    for (const o of ctx.observations) {
      const ref =
        o.ref_min || o.ref_max ? ` (interval ${o.ref_min ?? '?'}-${o.ref_max ?? '?'})` : '';
      const review = o.needs_review ? ' ⚠ needs_review=true' : '';
      const date = o.observed_at ?? 'dată necunoscută';
      const value = o.value ?? '';
      const unit = o.unit ?? '';
      lines.push(`- ${o.name}: ${value} ${unit}${ref}, ${date} [OBS:${o.id}]${review}`);
    }
  }
  if (ctx.documentChunks.length > 0) {
    lines.push('=== EXTRASE DOCUMENTE ===');
    for (const d of ctx.documentChunks) {
      lines.push(
        `[DOC:${d.label}|${d.documentId}] (${d.observedAt ?? 'dată necunoscută'}): "${d.text}"`
      );
    }
  }
  if (lines.length === 0) lines.push('(Niciun context găsit pentru această întrebare.)');
  return lines.join('\n');
}

const RX_OBS_CITATION = /\[OBS:([a-z0-9-]+)\]/gi;
const RX_DOC_CITATION = /\[DOC:([^|\]]+)\|([a-z0-9-]+)\]/gi;

function extractCitations(content: string): MedicalChatCitation[] {
  const out: MedicalChatCitation[] = [];
  for (const m of content.matchAll(RX_OBS_CITATION)) {
    out.push({ type: 'observation', id: m[1] });
  }
  for (const m of content.matchAll(RX_DOC_CITATION)) {
    out.push({ type: 'document', id: m[2], label: m[1] });
  }
  const seen = new Set<string>();
  return out.filter(c => {
    const k = `${c.type}:${c.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface SendMessageArgs {
  threadId: string;
  recordId: string;
  question: string;
}

export interface SendMessageResult {
  userMessage: MedicalChatMessage;
  assistantMessage: MedicalChatMessage;
}

export async function sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
  if (!args.question || args.question.trim() === '') {
    throw new Error('Întrebarea nu poate fi goală.');
  }

  const userMsg = await insertMessage({
    thread_id: args.threadId,
    recordId: args.recordId,
    role: 'user',
    content: args.question.trim(),
    citations: [],
  });

  const ctx = await retrieveContext(args.recordId, args.question);
  const ctxStr = buildContextString(ctx);

  const history = await listMessages(args.threadId);
  // Excludem mesajul user pe care tocmai l-am salvat — îl avem deja ca prompt.
  const trimmedHistory = history.filter(m => m.id !== userMsg.id).slice(-HISTORY_TURNS * 2);

  const aiMessages = [
    {
      role: 'system' as const,
      content: `${SYSTEM_PROMPT}\n\nContext dosar (filtrat pentru întrebarea curentă):\n${ctxStr}`,
    },
    ...trimmedHistory.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user' as const, content: args.question.trim() },
  ];

  let answer: string;
  try {
    answer = await sendAiRequest(aiMessages, 1000, 'chat');
  } catch (e) {
    console.warn('[medicalChat] sendAiRequest failed:', e);
    answer =
      e instanceof Error
        ? `Asistentul AI nu este disponibil acum: ${e.message}`
        : 'A apărut o eroare la asistentul AI. Încearcă din nou peste câteva momente.';
  }

  const citations = extractCitations(answer);

  const assistantMsg = await insertMessage({
    thread_id: args.threadId,
    recordId: args.recordId,
    role: 'assistant',
    content: answer,
    citations,
  });

  emit('entities:changed');

  // Auto-rename după primul schimb — fire-and-forget.
  autoRenameAfterFirstExchange(args.threadId).catch(() => {
    /* păstrăm titlu default */
  });

  return { userMessage: userMsg, assistantMessage: assistantMsg };
}

// ── Auto-rename thread ───────────────────────────────────────────────────────

/**
 * După primul schimb user→assistant, cere LLM un titlu scurt (≤5 cuvinte).
 * NO-OP dacă titlul a fost deja schimbat de user sau dacă există deja >2
 * mesaje (a fost rulat anterior).
 */
export async function autoRenameAfterFirstExchange(threadId: string): Promise<void> {
  const msgs = await listMessages(threadId);
  if (msgs.length < 2 || msgs.length > 4) return;

  const thread = await getThread(threadId);
  if (!thread) return;
  // Skip dacă userul l-a redenumit deja sau dacă nu mai e default.
  if (thread.title !== 'Conversație' && !thread.title.startsWith('Conversație ')) {
    return;
  }

  const firstQuestion = msgs.find(m => m.role === 'user')?.content ?? '';
  if (!firstQuestion) return;

  const prompt = `Generează un titlu scurt (maxim 5 cuvinte) în română pentru o conversație medicală despre subiectul de mai jos. Răspunde DOAR titlul, fără ghilimele, fără punct final.

Întrebare: "${firstQuestion.slice(0, 200)}"`;

  try {
    const title = (await sendAiRequest([{ role: 'user', content: prompt }], 30, 'chat'))
      .trim()
      .replace(/^["'„"]+|["'""]+$/g, '')
      .slice(0, 60);
    if (title.length >= 3) {
      await renameThread(threadId, title);
    }
  } catch {
    /* păstrăm titlu default */
  }
}
