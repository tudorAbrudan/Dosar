import { sendAiRequest } from './aiProvider';
import type { ExtractResult } from './ocrExtractors';
import type { DocumentType } from '@/types';
import { DOCUMENT_TYPE_LABELS } from '@/types';

const MAX_OCR_CHARS = 3000;

export async function extractFieldsWithLlm(
  type: DocumentType,
  ocrText: string
): Promise<ExtractResult> {
  const typeLabel = DOCUMENT_TYPE_LABELS[type] ?? type;
  const truncated = ocrText.slice(0, MAX_OCR_CHARS);

  const prompt = `Ești un asistent care extrage câmpuri structurate din textul OCR al unui document românesc.

Tip document: ${typeLabel}

Text OCR:
---
${truncated}
---

Extrage câmpurile disponibile. Returnează DOAR JSON valid, fără text suplimentar:
{
  "issue_date": "YYYY-MM-DD sau null",
  "expiry_date": "YYYY-MM-DD sau null",
  "metadata": {
    "cheie": "valoare"
  }
}

Reguli:
- Câmpuri utile în metadata: supplier, amount, invoice_number, tip_contract, policy_number, plate, vin, cnp, series, marca, model, due_date, period, insurer, bank, last4, lab, doctor, product_name — DOAR dacă le găsești în text
- Nu inventa valori. Dacă nu găsești o informație, omite câmpul sau pune null
- Datele trebuie să fie în format YYYY-MM-DD
- amount trebuie să fie număr cu punct zecimal (ex: "123.45")`;

  const response = await sendAiRequest(
    [{ role: 'user', content: prompt }],
    500
  );

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Răspuns AI invalid — nu conține JSON');

  const parsed = JSON.parse(jsonMatch[0]) as {
    issue_date?: string | null;
    expiry_date?: string | null;
    metadata?: Record<string, unknown>;
  };

  // Filtrează valorile non-string din metadata
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.metadata ?? {})) {
    if (typeof v === 'string' && v.trim()) {
      metadata[k] = v.trim();
    }
  }

  return {
    metadata,
    issue_date: typeof parsed.issue_date === 'string' ? parsed.issue_date : undefined,
    expiry_date: typeof parsed.expiry_date === 'string' ? parsed.expiry_date : undefined,
  };
}
