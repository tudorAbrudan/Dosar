import { useEffect, useState, useCallback } from 'react';
import {
  listMessages,
  sendMessage,
  listThreads,
  createThread,
  deleteThread as deleteThreadSvc,
  renameThread as renameThreadSvc,
} from '@/services/medicalChat';
import { on as subscribe } from '@/services/events';
import type { MedicalChatMessage, MedicalChatThread } from '@/types';

interface UseMedicalChatState {
  loading: boolean;
  sending: boolean;
  error: string | null;
  messages: MedicalChatMessage[];
  send(question: string): Promise<void>;
  refresh(): Promise<void>;
}

export function useMedicalChat(
  threadId: string | null,
  recordId: string | null
): UseMedicalChatState {
  const [messages, setMessages] = useState<MedicalChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setMessages(await listMessages(threadId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  const send = useCallback(
    async (question: string) => {
      if (!threadId || !recordId) return;
      const trimmed = question.trim();
      if (trimmed === '') return;
      setSending(true);
      setError(null);
      try {
        await sendMessage({ threadId, recordId, question: trimmed });
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Eroare necunoscută');
      } finally {
        setSending(false);
      }
    },
    [threadId, recordId, refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { loading, sending, error, messages, send, refresh };
}

interface UseMedicalChatThreadsState {
  loading: boolean;
  error: string | null;
  threads: MedicalChatThread[];
  refresh(): Promise<void>;
  create(title?: string): Promise<MedicalChatThread | null>;
  remove(threadId: string): Promise<void>;
  rename(threadId: string, title: string): Promise<void>;
}

export function useMedicalChatThreads(recordId: string | null): UseMedicalChatThreadsState {
  const [threads, setThreads] = useState<MedicalChatThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!recordId) {
      setThreads([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setThreads(await listThreads(recordId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare necunoscută');
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  const create = useCallback(
    async (title?: string): Promise<MedicalChatThread | null> => {
      if (!recordId) return null;
      try {
        const t = await createThread(recordId, title);
        await refresh();
        return t;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Eroare necunoscută');
        return null;
      }
    },
    [recordId, refresh]
  );

  const remove = useCallback(
    async (threadId: string) => {
      try {
        await deleteThreadSvc(threadId);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Eroare necunoscută');
      }
    },
    [refresh]
  );

  const rename = useCallback(
    async (threadId: string, title: string) => {
      try {
        await renameThreadSvc(threadId, title);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Eroare necunoscută');
      }
    },
    [refresh]
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const off = subscribe('entities:changed', () => {
      refresh();
    });
    return () => off();
  }, [refresh]);

  return { loading, error, threads, refresh, create, remove, rename };
}
