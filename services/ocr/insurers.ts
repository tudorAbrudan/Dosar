/**
 * Identificare asigurători români din text OCR — folosit de RCA, Casco, PAD,
 * asigurări profesionale.
 */

export const ROMANIAN_INSURERS = [
  'ALLIANZ',
  'GROUPAMA',
  'GENERALI',
  'OMNIASIG',
  'UNIQA',
  'ASIROM',
  'GRAWE',
  'SIGNAL IDUNA',
  'EUROINS',
  'AXERIA',
  'CITY INSURANCE',
  'METROPOLITAN',
  'GARANTA',
  'AXA',
  'CERTASIG',
];

/**
 * Prefixe distincte din nr. de poliță → asigurător.
 * Permite identificarea asiguratorului chiar când fontul e garbled.
 */
export const POLICY_PREFIX_TO_INSURER: [RegExp, string][] = [
  [/^RO\/?32V/i, 'Groupama'],
  [/^RO\/?0[17]/i, 'Allianz'],
  [/^RO\/?AA/i, 'Allianz'],
  [/^RO\/?GR/i, 'Grawe'],
  [/^RO\/?UN/i, 'Uniqa'],
  [/^RO\/?AS/i, 'Asirom'],
  [/^RO\/?OM/i, 'Omniasig'],
  [/^RO\/?GN/i, 'Generali'],
  [/^RO\/?EU/i, 'Euroins'],
  [/^RO\/?AX/i, 'Axeria'],
  [/^PAD/i, 'Pool-ul de Asigurare'],
];

export function detectInsurer(text: string): string | undefined {
  const tu = text.toUpperCase();
  for (const ins of ROMANIAN_INSURERS) {
    if (tu.includes(ins)) return ins;
  }
  return undefined;
}

export function detectInsurerFromPolicyNumber(policyNumber: string): string | undefined {
  for (const [pattern, name] of POLICY_PREFIX_TO_INSURER) {
    if (pattern.test(policyNumber)) return name;
  }
  return undefined;
}
