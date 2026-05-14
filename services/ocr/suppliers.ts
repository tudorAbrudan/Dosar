/**
 * Detectare furnizori utilități români — folosit pentru facturi (utility) și
 * pentru auto-ștergere de 5 ani pe utilități cunoscute (vezi `add.tsx`).
 */

export const ROMANIAN_UTILITY_SUPPLIERS = [
  'E.ON Energie',
  'E.ON',
  'Engie Romania',
  'Engie',
  'Electrica Furnizare',
  'Electrica',
  'CEZ Vânzare',
  'CEZ',
  'Enel Energie',
  'Enel',
  'Digi Communications',
  'Digi',
  'RCS&RDS',
  'RCS & RDS',
  'Vodafone Romania',
  'Vodafone',
  'Orange Romania',
  'Orange',
  'Telekom Romania',
  'Telekom',
  'UPC Romania',
  'UPC',
  'Apă Nova',
  'Apa Nova',
  'Apa Canal',
  'Aquatim',
  'Distrigaz',
  'Romgaz',
  'Transgaz',
  'Hidroelectrica',
  'DEER',
  'Delgaz Grid',
  'Termoenergetica',
  'RADET',
];

export function detectUtilitySupplier(text: string): string | undefined {
  const tu = text.toUpperCase();
  for (const s of ROMANIAN_UTILITY_SUPPLIERS) {
    if (tu.includes(s.toUpperCase())) return s;
  }
  return undefined;
}

export function isKnownUtilitySupplier(supplier: string): boolean {
  const su = supplier.toUpperCase();
  return ROMANIAN_UTILITY_SUPPLIERS.some(
    s => su.includes(s.toUpperCase()) || s.toUpperCase().includes(su)
  );
}
