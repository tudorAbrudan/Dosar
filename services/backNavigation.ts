/**
 * Întoarcerea dintr-un ecran al stack-ului Documente (detaliu, adăugare) pe
 * ecranul de unde a pornit.
 *
 * `router.push` către `/(tabs)/documente/...` din alt tab pune ecranul peste
 * stack-ul Documente, iar `router.back()` ajunge apoi pe lista Documente, nu la
 * sursă (lecția 2026-05-31). Apelantul trimite `from` (+ `entityId`), iar
 * ecranul-țintă îi dă helper-ului parametrii primiți. Verificat automat de
 * `scripts/cross-tab-back-audit.js`.
 */
import { router, type Href } from 'expo-router';

function sourceRoute(from?: string, entityId?: string): Href | null {
  switch (from) {
    case 'home':
      return '/(tabs)';
    case 'expirari':
      return '/(tabs)/expirari';
    case 'chat':
      return '/(tabs)/chat';
    case 'entity':
      return entityId ? `/(tabs)/entitati/${entityId}` : null;
    case 'medical':
      return entityId ? `/(tabs)/entitati/medical/${entityId}?tab=documente` : null;
    case 'medical-chat':
      return entityId ? `/(tabs)/entitati/medical/${entityId}?tab=chat` : null;
    default:
      return null;
  }
}

/**
 * Revine pe ecranul sursă. `false` = sursă necunoscută (navigare din tabul
 * Documente, notificare, deep link) — apelantul alege fallback-ul.
 */
export function navigateBackToSource(from?: string, entityId?: string): boolean {
  const target = sourceRoute(from, entityId);
  if (!target) return false;
  // Întâi golim stack-ul Documente, apoi trecem pe tabul sursă. Ambele navigate
  // sunt grupate de React Navigation → fără flash.
  router.navigate('/(tabs)/documente');
  router.navigate(target);
  return true;
}
