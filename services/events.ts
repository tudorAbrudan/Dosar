/**
 * Event bus pentru mutațiile de date.
 *
 * Producători: funcții din `services/` care modifică SQLite.
 * Consumatori: hook-uri (`useDocuments`, `useOrphans`, etc.) care apelează
 * `refresh()` la primirea evenimentului.
 *
 * Evenimentele se acumulează într-un microtask și se livrează deduplicate,
 * astfel încât o operație care emite de N ori (ex. import backup) declanșează
 * un singur refresh per listener.
 */

export type AppEvent =
  | 'documents:changed'
  | 'links:changed'
  | 'entities:changed'
  | 'customTypes:changed'
  | 'settings:changed'
  | 'reminders:changed'
  | 'sharing:changed';

const listeners: Record<AppEvent, Set<() => void>> = {
  'documents:changed': new Set(),
  'links:changed': new Set(),
  'entities:changed': new Set(),
  'customTypes:changed': new Set(),
  'settings:changed': new Set(),
  'reminders:changed': new Set(),
  'sharing:changed': new Set(),
};

const pending = new Set<AppEvent>();
let scheduled = false;

function flush(): void {
  const events = [...pending];
  pending.clear();
  scheduled = false;
  const called = new Set<() => void>();
  for (const e of events) {
    for (const fn of listeners[e]) {
      if (called.has(fn)) continue;
      called.add(fn);
      try {
        fn();
      } catch {
        // Un listener care aruncă nu trebuie să oprească restul.
      }
    }
  }
}

const schedule: (cb: () => void) => void =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (cb: () => void) => {
        Promise.resolve().then(cb);
      };

export function on(event: AppEvent, fn: () => void): () => void {
  listeners[event].add(fn);
  return () => {
    listeners[event].delete(fn);
  };
}

export function emit(event: AppEvent): void {
  pending.add(event);
  if (scheduled) return;
  scheduled = true;
  schedule(flush);
}
