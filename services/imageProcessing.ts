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
 * Profil de compresie pentru imaginile trimise la AI vision.
 *
 * Providerii vision (Pixtral/Mistral, GPT-4o, Claude) redimensionează intern
 * imaginea înainte de tokenizare, iar numărul de tokeni crește cu suprafața —
 * peste ~1300px lățime nu mai câștigi lizibilitate, doar payload și tokeni.
 * De aceea trimitem 1280px q=0.75 (~150–250 KB base64) în loc de 2048px q=0.8.
 */
export interface AiImageProfile {
  width: number;
  compress: number;
}

/** Documente unde detaliile fine decid corectitudinea (ștampilă ITP scrisă de
 *  mână peste hologramă, serii minuscule) — merită pixelii în plus. */
export const AI_IMAGE_PROFILE_HIGH_DETAIL: AiImageProfile = { width: 1600, compress: 0.85 };
export const AI_IMAGE_PROFILE_DEFAULT: AiImageProfile = { width: 1280, compress: 0.75 };

export function getAiImageProfile(type?: DocumentType): AiImageProfile {
  return type && HIGH_DETAIL_TYPES.includes(type)
    ? AI_IMAGE_PROFILE_HIGH_DETAIL
    : AI_IMAGE_PROFILE_DEFAULT;
}

/**
 * Pregătește o imagine pentru trimitere la AI vision: resize + JPEG conform
 * profilului, returnează base64. Curăță fișierul intermediar.
 *
 * Necesar pentru cazul PDF: `renderPdfFirstPageForVision` randează la 200 DPI
 * (poate da 1–3 MB JPEG pentru A4 medical scan) → base64 1.4–4 MB → iOS
 * NSURLSession respinge request-ul cu „Network request failed" la upload.
 *
 * OBLIGATORIU și pentru fișierele deja salvate prin `processDocumentImage`
 * (2048–3072px pe disc): trimise brut la AI, costă de 3–5 ori mai mulți tokeni
 * de imagine și secunde bune de upload, fără câștig de acuratețe.
 */
export async function compressImageToBase64ForAi(
  uri: string,
  profile: AiImageProfile = AI_IMAGE_PROFILE_DEFAULT
): Promise<string> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: profile.width } }],
    { compress: profile.compress, format: ImageManipulator.SaveFormat.JPEG }
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
