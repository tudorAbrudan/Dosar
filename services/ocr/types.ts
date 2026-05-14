/**
 * Tipuri partajate pentru toate extractoarele OCR per tip de document.
 */

export interface ExtractResult {
  /** Câmpurile-cheie extrase, mapate pe `key` din `types/documentFields.ts`. */
  metadata: Record<string, string>;
  /** YYYY-MM-DD */
  expiry_date?: string;
  /** YYYY-MM-DD */
  issue_date?: string;
  /** Rezumat scurt (de obicei generat de AI). */
  note?: string;
  /**
   * Transcriere structurată completă produsă de AI vision. Suprascrie OCR-ul
   * on-device în câmpul `documents.ocr_text` (afișat ca „Text complet (OCR)").
   */
  ocr_text?: string;
}
