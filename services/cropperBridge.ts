/**
 * Bridge promise-based pentru a returna rezultatul ecranului /cropper către
 * apelant. Expo Router nu suportă `router.push(...).then(result)`, deci
 * folosim un registru in-memory de resolver-i indexat după requestId.
 *
 * Flow:
 *   1. Apelantul cheamă `awaitCropper(id)` → primește un Promise.
 *   2. Navighează la /cropper cu acel `requestId` în params.
 *   3. Ecranul /cropper apelează `resolveCropper(id, croppedUri | null)`.
 *   4. Promise-ul se rezolvă cu URI-ul cropped sau null la cancel.
 */

import { router } from 'expo-router';

type Resolver = (croppedUri: string | null) => void;

const pending = new Map<string, Resolver>();

export function awaitCropper(requestId: string): Promise<string | null> {
  return new Promise(resolve => {
    pending.set(requestId, resolve);
  });
}

export function resolveCropper(requestId: string, croppedUri: string | null): void {
  const resolver = pending.get(requestId);
  if (resolver) {
    pending.delete(requestId);
    resolver(croppedUri);
  }
}

export function makeRequestId(): string {
  return `crop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Trimite o imagine prin ecranul /cropper și așteaptă rezultatul.
 * Returnează URI-ul decupat, sau `null` dacă utilizatorul a anulat.
 *
 * SINGURA cale prin care o imagine aleasă din Galerie / Din Fișiere ajunge
 * pagină de document. Până pe 2026-07-29 pasul ăsta exista doar în ecranul de
 * adăugare document; la un document existent (editare sau detaliu) poza intra
 * direct, fără ajustarea marginilor. Orice sursă nouă de imagine trece pe aici.
 *
 * Excepție legitimă: scanner-ul nativ (`scanDocumentPages`) — face deja
 * detecția marginilor, deci nu se mai trece încă o dată prin cropper.
 *
 * Imaginea rezultată are EXIF-ul normalizat de `expo-perspective-crop`, deci
 * apelantul NU mai pasează orientarea originală mai departe.
 */
export async function cropImage(uri: string): Promise<string | null> {
  const requestId = makeRequestId();
  const cropPromise = awaitCropper(requestId);
  router.push({ pathname: '/cropper', params: { uri, requestId } });
  return cropPromise;
}
