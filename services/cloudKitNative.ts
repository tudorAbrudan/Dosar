/**
 * Acces la modulul nativ CloudKit (`modules/expo-cloudkit-share`), comun pentru
 * orchestrarea partajării (`cloudShare.ts`) și închiderea partajărilor
 * (`shareClosing.ts`).
 */
import type * as CloudKitShareModule from '@/modules/expo-cloudkit-share/src';

// Import lazy al modulului nativ: ecranul de UI se randează în simulator chiar
// dacă modulul nu e încă linkat (înainte de prebuild). Apelurile eșuează grațios.
/* eslint-disable @typescript-eslint/no-var-requires */
let nativeModule: typeof CloudKitShareModule | null = null;
export function native(): typeof CloudKitShareModule {
  if (!nativeModule) {
    nativeModule = require('@/modules/expo-cloudkit-share/src') as typeof CloudKitShareModule;
  }
  return nativeModule;
}

/** True dacă eroarea CloudKit înseamnă „zona nu (mai) există pe server". */
export function isZoneGoneError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /zone does not exist|zone not found|zonenotfound/i.test(msg);
}
