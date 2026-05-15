/**
 * OCR + auto-rotate pentru imagini de document.
 *
 * Dacă textul OCR inițial e prea scurt (sub 30 caractere), încearcă 90°, 270°,
 * 180° și păstrează versiunea cu cele mai multe caractere (heuristic „mai mult
 * text recognosc = orientare mai bună"). Persistă rotația prin suprascrierea
 * fișierului original.
 *
 * `isLocked` = userul a fixat rotația manual din UI → respectăm orientarea
 * curentă, nu mai încercăm.
 */
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

import { extractText } from '@/services/ocr';
import { toFileUri } from '@/services/fileUtils';

const MIN_TEXT_LEN = 30;
const ROTATIONS = [90, 270, 180] as const;

export async function ocrWithAutoRotate(
  storedPath: string,
  isLocked: boolean
): Promise<{ text: string; rotated: boolean }> {
  const fileUri = toFileUri(storedPath);
  let { text } = await extractText(fileUri);

  if (isLocked) return { text, rotated: false };
  if (text.trim().length >= MIN_TEXT_LEN) return { text, rotated: false };

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
    if (bestText.trim().length >= MIN_TEXT_LEN) break;
  }

  const wasRotated = bestUri !== fileUri;
  if (wasRotated) {
    const absoluteUri = toFileUri(storedPath);
    const destPath = absoluteUri.startsWith('file://') ? absoluteUri.slice(7) : absoluteUri;
    await FileSystem.copyAsync({ from: bestUri, to: destPath });
  }

  return { text: bestText, rotated: wasRotated };
}
