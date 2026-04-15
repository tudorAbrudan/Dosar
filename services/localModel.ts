/**
 * localModel.ts — Gestionează modele LLM locale (llama.rn / GGUF Q4_K_M).
 *
 * Responsabilități:
 * - Catalog static de modele (6 modele IT)
 * - Verificare compatibilitate device (RAM + generație iPhone)
 * - Download cu progress callback
 * - Persistență selecție în AsyncStorage
 * - Inferență via llama.rn
 * - Flag OCR local
 */

// ─── Tipuri ───────────────────────────────────────────────────────────────────

export interface LocalModelEntry {
  id: string;
  name: string;
  description: string;
  /** Dimensiune aproximativă în bytes */
  sizeBytes: number;
  /** Label afișat în UI, ex: "~1.5GB" */
  sizeLabel: string;
  /** RAM minim necesar în bytes */
  minRamBytes: number;
  /** Generație minimă iPhone (ex: 14 = iPhone 14) */
  minIphoneGen: number;
  /** Stele calitate 1–5 */
  qualityStars: number;
  /** URL HuggingFace pentru descărcare fișier GGUF */
  downloadUrl: string;
}

export type DownloadProgressCallback = (
  progress: number,
  downloadedMb: number,
  totalMb: number
) => void;

// ─── Catalog ─────────────────────────────────────────────────────────────────

export const LOCAL_MODEL_CATALOG: LocalModelEntry[] = [
  {
    id: 'llama3-1b',
    name: 'Llama 3.2 1B IT',
    description: 'Cel mai mic și mai rapid. Bun pentru întrebări simple și căutări. Ocupă puțin spațiu.',
    sizeBytes: 800 * 1024 * 1024,
    sizeLabel: '~800MB',
    minRamBytes: 4 * 1024 * 1024 * 1024,
    minIphoneGen: 12,
    qualityStars: 2,
    downloadUrl:
      'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'gemma4-2b',
    name: 'Gemma 4 2B IT',
    description:
      'Model Google de ultimă generație. Excelent la documente, răspunsuri precise. Recomandat pentru iPhone 13+.',
    sizeBytes: 1500 * 1024 * 1024,
    sizeLabel: '~1.5GB',
    minRamBytes: 4 * 1024 * 1024 * 1024,
    minIphoneGen: 13,
    qualityStars: 4,
    downloadUrl:
      'https://huggingface.co/bartowski/gemma-4-2b-it-GGUF/resolve/main/gemma-4-2b-it-Q4_K_M.gguf',
  },
  {
    id: 'phi3-mini',
    name: 'Phi-3 Mini 3.8B IT',
    description: 'Model Microsoft, optimizat pentru raționament și extracție date structurate.',
    sizeBytes: 2300 * 1024 * 1024,
    sizeLabel: '~2.3GB',
    minRamBytes: 6 * 1024 * 1024 * 1024,
    minIphoneGen: 14,
    qualityStars: 4,
    downloadUrl:
      'https://huggingface.co/bartowski/Phi-3-mini-4k-instruct-GGUF/resolve/main/Phi-3-mini-4k-instruct-Q4_K_M.gguf',
  },
  {
    id: 'ministral-3b',
    name: 'Ministral 3B IT',
    description: 'Model Mistral compact. Bun la urmarea instrucțiunilor și extracție date.',
    sizeBytes: 2000 * 1024 * 1024,
    sizeLabel: '~2GB',
    minRamBytes: 6 * 1024 * 1024 * 1024,
    minIphoneGen: 14,
    qualityStars: 4,
    downloadUrl:
      'https://huggingface.co/bartowski/Ministral-3B-Instruct-GGUF/resolve/main/Ministral-3B-Instruct-Q4_K_M.gguf',
  },
  {
    id: 'gemma4-4b',
    name: 'Gemma 4 4B IT',
    description: 'Versiunea extinsă Gemma 4. Calitate maximă în clasa 4B. Recomandat pentru iPhone 14+.',
    sizeBytes: 2500 * 1024 * 1024,
    sizeLabel: '~2.5GB',
    minRamBytes: 6 * 1024 * 1024 * 1024,
    minIphoneGen: 14,
    qualityStars: 5,
    downloadUrl:
      'https://huggingface.co/bartowski/gemma-4-4b-it-GGUF/resolve/main/gemma-4-4b-it-Q4_K_M.gguf',
  },
  {
    id: 'mistral-7b',
    name: 'Mistral 7B IT',
    description: 'Calitate maximă disponibilă local. Necesită iPhone 15 Pro+ și ~4GB spațiu liber.',
    sizeBytes: 4100 * 1024 * 1024,
    sizeLabel: '~4.1GB',
    minRamBytes: 8 * 1024 * 1024 * 1024,
    minIphoneGen: 15,
    qualityStars: 5,
    downloadUrl:
      'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
  },
];
