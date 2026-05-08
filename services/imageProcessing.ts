import * as ImageManipulator from 'expo-image-manipulator';
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
