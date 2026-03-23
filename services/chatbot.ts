import { getPersons, getProperties, getVehicles, getCards, getAnimals } from './entities';
import { getDocuments } from './documents';
import { DOCUMENT_TYPE_LABELS } from '@/types';

const MISTRAL_API_URL = 'https://api.mistral.ai/v1/chat/completions';
const MISTRAL_API_KEY = process.env.EXPO_PUBLIC_MISTRAL_API_KEY ?? '';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function buildContext(): Promise<string> {
  const [persons, properties, vehicles, cards, animals, documents] = await Promise.all([
    getPersons(),
    getProperties(),
    getVehicles(),
    getCards(),
    getAnimals(),
    getDocuments(),
  ]);

  const lines: string[] = ['=== DATE APLICAȚIE ==='];

  if (persons.length) lines.push(`Persoane: ${persons.map((p) => p.name).join(', ')}`);
  if (properties.length) lines.push(`Proprietăți: ${properties.map((p) => p.name).join(', ')}`);
  if (vehicles.length) lines.push(`Vehicule: ${vehicles.map((v) => v.name).join(', ')}`);
  if (cards.length)
    lines.push(`Carduri: ${cards.map((c) => `${c.nickname} (****${c.last4})`).join(', ')}`);
  if (animals.length)
    lines.push(`Animale: ${animals.map((a) => `${a.name} (${a.species})`).join(', ')}`);

  lines.push('\nDocumente:');
  for (const doc of documents) {
    const entity =
      persons.find((p) => p.id === doc.person_id)?.name ??
      vehicles.find((v) => v.id === doc.vehicle_id)?.name ??
      properties.find((p) => p.id === doc.property_id)?.name ??
      cards.find((c) => c.id === doc.card_id)?.nickname ??
      animals.find((a) => a.id === doc.animal_id)?.name ??
      null;
    const label = DOCUMENT_TYPE_LABELS[doc.type] ?? doc.type;
    const expiry = doc.expiry_date ? ` | expiră: ${doc.expiry_date}` : '';
    const issued = doc.issue_date ? ` | emis: ${doc.issue_date}` : '';
    const entityStr = entity ? ` (${entity})` : '';
    const note = doc.note ? ` | notă: ${doc.note}` : '';

    // Metadata specifică tipului (nr. înmatriculare, CNP, serie, etc.)
    let meta = '';
    if (doc.metadata) {
      try {
        const parsed = typeof doc.metadata === 'string' ? JSON.parse(doc.metadata) : doc.metadata;
        const metaParts = Object.entries(parsed as Record<string, string>)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`);
        if (metaParts.length) meta = ` | ${metaParts.join(', ')}`;
      } catch { /* metadata coruptă */ }
    }

    // Text OCR complet (trunchiat la 800 de caractere pentru context)
    const ocrText = doc.ocr_text
      ? ` | OCR: ${doc.ocr_text.slice(0, 800)}${doc.ocr_text.length > 800 ? '…' : ''}`
      : '';

    lines.push(`- [ID:${doc.id}] ${label}${entityStr}${issued}${expiry}${note}${meta}${ocrText}`);
  }

  return lines.join('\n');
}

interface MistralResponse {
  choices: Array<{ message: { content: string } }>;
}

export async function sendMessage(
  userMessage: string,
  history: ChatMessage[]
): Promise<string> {
  const context = await buildContext();

  const systemPrompt = `Ești un asistent pentru aplicația de documente personale. Răspunzi în română.
Ai acces la datele utilizatorului:

${context}

Când răspunzi:
- Fii concis și util
- Dacă întrebarea e despre documente/entități, bazează-te pe datele de mai sus
- Când menționezi un document specific, include ID-ul lui în format [ID:xxx] ca să poată fi deschis
- Nu inventa date care nu există în context`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const response = await fetch(MISTRAL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages,
      max_tokens: 500,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral API error: ${response.status} – ${err}`);
  }

  const data = (await response.json()) as MistralResponse;
  return data.choices[0]?.message?.content ?? 'Fără răspuns.';
}
