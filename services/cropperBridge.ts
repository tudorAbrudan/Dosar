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
