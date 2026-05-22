import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import type { DocumentType } from '@/types';

/**
 * Tipuri unde detaliile fine contează pentru OCR/AI vision (ștampile mici cu
 * scris de mână peste hologramă, serii minuscule). Pentru acestea folosim
 * rezoluție și calitate JPEG mai mari ca să nu pierdem informația din zona
 * critică (ex. ștampila RAR cu data ITP scrisă pe 2-3 linii).
 */
const HIGH_DETAIL_TYPES: DocumentType[] = ['talon', 'itp'];

interface ImageProfile {
  width: number;
  compress: number;
}

function getProfile(type: DocumentType): ImageProfile {
  return HIGH_DETAIL_TYPES.includes(type)
    ? { width: 3072, compress: 0.9 }
    : { width: 2048, compress: 0.82 };
}

/**
 * Normalizează o imagine pentru salvarea ca atașament document:
 * - bake-in EXIF rotation (dacă e furnizat)
 * - resize la lățimea profilului (păstrează aspect ratio)
 * - JPEG cu calitatea profilului
 *
 * Pentru `talon`/`itp` profilul e mai generos (3072px, q=0.9) ca să rămână
 * lizibilă ștampila handwritten peste hologramă; restul tipurilor folosesc
 * profilul standard (2048px, q=0.82) care e suficient pentru OCR text printat.
 */
export async function processDocumentImage(
  uri: string,
  type: DocumentType,
  exifOrientation?: number
): Promise<string> {
  const profile = getProfile(type);
  const actions: ImageManipulator.Action[] = [];

  if (exifOrientation && exifOrientation !== 1) {
    let deg = 0;
    if (exifOrientation === 3) deg = 180;
    else if (exifOrientation === 6) deg = 90;
    else if (exifOrientation === 8) deg = -90;
    if (deg !== 0) actions.push({ rotate: deg });
  }
  actions.push({ resize: { width: profile.width } });

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: profile.compress,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return result.uri;
}

/**
 * Pregătește o imagine pentru trimitere la AI vision: resize la max 2048px lățime
 * + JPEG q=0.8, returnează base64. Curăță fișierul intermediar.
 *
 * Necesar pentru cazul PDF: `renderPdfFirstPageForVision` randează la 200 DPI
 * (poate da 1–3 MB JPEG pentru A4 medical scan) → base64 1.4–4 MB → iOS
 * NSURLSession respinge request-ul cu „Network request failed" la upload.
 * Trecerea prin acest helper aduce payload-ul sub 1 MB consistent.
 *
 * Pentru fișiere JPEG salvate prin `processDocumentImage` (deja 2048–3072px),
 * apelul e ieftin (no-op vizual) — recompresează la 2048 q=0.8 ca asigurare
 * suplimentară pentru cazurile cu rotire manuală sau alte transformări care
 * pot crește dimensiunea de pe disc.
 */
export async function compressImageToBase64ForAi(uri: string): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 2048 } }],
    { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
  );
  try {
    return await FileSystem.readAsStringAsync(result.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } finally {
    const path = result.uri.startsWith('file://') ? result.uri.slice(7) : result.uri;
    FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
}
