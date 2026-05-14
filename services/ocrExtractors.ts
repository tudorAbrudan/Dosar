/**
 * Barrel re-export. Implementarea s-a mutat în `services/ocr/*.ts` (split per
 * categorie de document). Acest fișier rămâne pentru compatibilitate cu codul
 * care îl importă direct (`app/(tabs)/documente/*.tsx`, `services/ocrLlmExtractor.ts`).
 */
export type { ExtractResult } from './ocr/index';
export { extractFieldsForType, isKnownUtilitySupplier } from './ocr/index';
