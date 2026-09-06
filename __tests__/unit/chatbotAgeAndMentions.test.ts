/**
 * Regresii raportate 2026-09-03, model local Qwen 3.5 2B:
 *  - „ce vârstă are @Silvia?" → răspuns despre ALTĂ persoană;
 *  - vârstă calculată de model: „2 ani și 10 luni" pentru născut în 1985.
 *
 * Ambele au cauză în cod, nu în model: entitățile nu erau filtrate după
 * @mențiune, iar vârsta era lăsată pe seama modelului.
 */
import { computeAgeYears, birthDateFromCnp, trimHistoryForLocal } from '@/services/chatbot';

describe('computeAgeYears', () => {
  const now = new Date(Date.UTC(2026, 8, 3)); // 2026-09-03

  it('calculează vârsta pentru cazul raportat (născut 1985-09-28)', () => {
    // Modelul răspunsese „2 ani și 10 luni". Ziua de naștere nu a trecut încă.
    expect(computeAgeYears('1985-09-28', now)).toBe(40);
  });

  it('adaugă anul după ce trece ziua de naștere', () => {
    expect(computeAgeYears('1985-09-01', now)).toBe(41);
  });

  it('tratează ziua de naștere fix azi ca an împlinit', () => {
    expect(computeAgeYears('1985-09-03', now)).toBe(41);
  });

  it('calculează corect pentru un copil mic', () => {
    expect(computeAgeYears('2020-02-01', now)).toBe(6);
  });

  it('întoarce null pentru dată lipsă sau malformată', () => {
    expect(computeAgeYears(undefined, now)).toBeNull();
    expect(computeAgeYears('', now)).toBeNull();
    expect(computeAgeYears('1985', now)).toBeNull();
    expect(computeAgeYears('01.02.1985', now)).toBeNull();
  });

  it('întoarce null pentru date calendaristic imposibile', () => {
    // Fără verificarea de round-trip, Date normalizează 31 feb → 3 martie
    expect(computeAgeYears('2020-02-31', now)).toBeNull();
    expect(computeAgeYears('2020-13-01', now)).toBeNull();
  });

  it('întoarce null pentru date în viitor (nu afirmă vârste negative)', () => {
    expect(computeAgeYears('2030-01-01', now)).toBeNull();
  });
});

describe('birthDateFromCnp', () => {
  it('extrage data din CNP-ul real raportat', () => {
    // 2850928314026 → S=2 (feminin, 1900-1999), 85-09-28
    expect(birthDateFromCnp('2850928314026')).toBe('1985-09-28');
  });

  it('vârsta dedusă din CNP e cea corectă (nu „42 de ani" inventat)', () => {
    const now = new Date(Date.UTC(2026, 8, 4));
    expect(computeAgeYears(birthDateFromCnp('2850928314026')!, now)).toBe(40);
  });

  it('acoperă toate prefixele de secol', () => {
    expect(birthDateFromCnp('1850928314026')).toBe('1985-09-28'); // masculin 1900s
    expect(birthDateFromCnp('5050928314026')).toBe('2005-09-28'); // 2000s
    expect(birthDateFromCnp('3850928314026')).toBe('1885-09-28'); // 1800s
  });

  it('respinge CNP-uri invalide', () => {
    expect(birthDateFromCnp(undefined)).toBeNull();
    expect(birthDateFromCnp('123')).toBeNull();
    expect(birthDateFromCnp('0850928314026')).toBeNull(); // prefix 0 inexistent
    expect(birthDateFromCnp('2851328314026')).toBeNull(); // luna 13
    expect(birthDateFromCnp('2850231314026')).toBeNull(); // 31 februarie
  });
});

describe('trimHistoryForLocal', () => {
  const msg = (n: number, len: number) => ({
    role: (n % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: 'x'.repeat(len),
  });

  it('păstrează mesajele recente, le taie pe cele vechi', () => {
    // Istoricul creștea nelimitat și depășea fereastra → „Context is full"
    // chiar și la o întrebare scurtă. Raportat pe device 2026-09-04.
    const history = [msg(0, 3000), msg(1, 3000), msg(2, 1000)];
    const kept = trimHistoryForLocal(history, 4000);
    expect(kept.length).toBeLessThan(history.length);
    expect(kept[kept.length - 1]).toBe(history[history.length - 1]);
  });

  it('nu taie nimic dacă totul încape', () => {
    const history = [msg(0, 100), msg(1, 100)];
    expect(trimHistoryForLocal(history, 4000)).toHaveLength(2);
  });

  it('păstrează măcar ultimul mesaj, trunchiat, dacă singur depășește bugetul', () => {
    const kept = trimHistoryForLocal([msg(0, 10000)], 4000);
    expect(kept).toHaveLength(1);
    expect(kept[0].content.length).toBe(4000);
  });

  it('întoarce listă goală pentru istoric gol', () => {
    expect(trimHistoryForLocal([], 4000)).toEqual([]);
  });
});
