/**
 * Contoare de cereri, în memorie.
 *
 * ATENȚIE la ce NU garantează asta: Rapids e scale-to-zero, deci containerul
 * moare când nu vine trafic, iar contoarele pleacă cu el. Un atacator răbdător
 * poate aștepta un cold start ca să-și reseteze cota. Contoarele sunt un filtru
 * de abuz obișnuit, nu o plasă etanșă — stopul real rămâne plafonul de
 * cheltuială setat în contul Mistral.
 *
 * Dacă ajunge să conteze, mută starea într-un Valkey (Danube, ~6,49€/lună) și
 * păstrează exact aceeași interfață.
 */

/** @type {Map<string, { day: string, count: number }>} */
const perDevice = new Map();
let global = { day: '', count: 0 };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Curăță intrările din zilele trecute. Rulat la fiecare verificare: Map-ul
 * crește cu numărul de device-uri active azi, nu la nesfârșit.
 */
function evictStale(day) {
  for (const [key, entry] of perDevice) {
    if (entry.day !== day) perDevice.delete(key);
  }
}

/**
 * @param {string} deviceId
 * @param {{ perDeviceDailyLimit: number, globalDailyLimit: number }} limits
 * @returns {{ ok: true } | { ok: false, scope: 'device' | 'global' }}
 */
export function checkAndCount(deviceId, limits) {
  const day = today();

  if (global.day !== day) {
    global = { day, count: 0 };
    evictStale(day);
  }

  if (global.count >= limits.globalDailyLimit) {
    return { ok: false, scope: 'global' };
  }

  const entry = perDevice.get(deviceId);
  const current = entry && entry.day === day ? entry.count : 0;
  if (current >= limits.perDeviceDailyLimit) {
    return { ok: false, scope: 'device' };
  }

  perDevice.set(deviceId, { day, count: current + 1 });
  global = { day, count: global.count + 1 };
  return { ok: true };
}

/** Doar pentru /health și teste. Nu expune identificatori de device. */
export function stats() {
  return { day: global.day, globalCount: global.count, devicesToday: perDevice.size };
}

/** Doar pentru teste. */
export function __reset() {
  perDevice.clear();
  global = { day: '', count: 0 };
}
