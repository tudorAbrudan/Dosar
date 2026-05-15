/**
 * OCR + auto-rotate pentru imagini de document.
 *
 * Încearcă 90°, 270°, 180° și păstrează versiunea cu cele mai multe caractere
 * (heuristic „mai mult text recognoscut = orientare mai bună"). Persistă
 * rotația prin suprascrierea fișierului original.
 *
 * Parametri:
 * - `isLocked = true` (user a fixat rotația manual din UI) — respectăm
 *   orientarea curentă și nu mai încercăm.
 * - `quickAcceptMinLen` (default `0` — încearcă mereu toate rotațiile):
 *   dacă textul inițial sau cel rotat are deja `>=` caractere, oprește
 *   căutarea. Util când Vision pe iOS modern extrage deja text suficient.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

import { extractText } from '@/services/ocr';
import { toFileUri } from '@/services/fileUtils';

const ROTATIONS = [90, 270, 180] as const;

export async function ocrWithAutoRotate(
  storedPath: string,
  isLocked: boolean,
  options: { quickAcceptMinLen?: number } = {}
): Promise<{ text: string; rotated: boolean }> {
  const { quickAcceptMinLen = 0 } = options;
  const fileUri = toFileUri(storedPath);
  const { text } = await extractText(fileUri);

  if (isLocked) return { text, rotated: false };
  if (quickAcceptMinLen > 0 && text.trim().length >= quickAcceptMinLen) {
    return { text, rotated: false };
  }

  let bestText = text;
  let bestUri = fileUri;

  for (const deg of ROTATIONS) {
    const r = await ImageManipulator.manipulateAsync(fileUri, [{ rotate: deg }], {
      compress: 0.92,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    const { text: rotText } = await extractText(r.uri);
    if (rotText.trim().length > bestText.trim().length) {
      bestText = rotText;
      bestUri = r.uri;
    }
    if (quickAcceptMinLen > 0 && bestText.trim().length >= quickAcceptMinLen) break;
  }

  const wasRotated = bestUri !== fileUri;
  if (wasRotated) {
    await FileSystem.copyAsync({ from: bestUri, to: fileUri });
  }

  return { text: bestText, rotated: wasRotated };
}
