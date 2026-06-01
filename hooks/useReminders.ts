import { useEffect, useState, useCallback } from 'react';
import * as remindersService from '@/services/reminders';
import { on } from '@/services/events';
import type { Reminder } from '@/types';

export function useReminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await remindersService.listActiveReminders();
      setReminders(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Eroare la încărcarea reminderelor');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const off = on('reminders:changed', () => refresh());
    return () => off();
  }, [refresh]);

  useEffect(() => {
    const off = on('documents:changed', () => refresh());
    return () => off();
  }, [refresh]);

  return { reminders, loading, error, refresh };
}
