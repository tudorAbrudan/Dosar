/**
 * Opțiuni pentru câmpul `auto_delete` (retenție document) — sursă unică
 * pentru picker-ul din add.tsx / edit.tsx și pentru afișarea read-only
 * din [id].tsx.
 *
 * Reguli valide:
 *   - `null`               → niciodată (nu se șterge automat)
 *   - `'<N>d'`             → la N zile după issue_date
 *   - `'expiry'`           → la data expirării (folosit pentru documente cu
 *                            `expiry_date`; nu apare ca opțiune în picker
 *                            dar e suportat de schemă)
 */

export interface RetentionOption {
  label: string;
  value: string | null;
}

export const RETENTION_OPTIONS: readonly RetentionOption[] = [
  { label: 'Niciodată', value: null },
  { label: '30 zile', value: '30d' },
  { label: '90 zile', value: '90d' },
  { label: '180 zile', value: '180d' },
  { label: '1 an', value: '365d' },
  { label: '2 ani', value: '730d' },
  { label: '3 ani', value: '1095d' },
  { label: '4 ani', value: '1460d' },
  { label: '5 ani', value: '1825d' },
] as const;

/** Label uman pentru orice valoare `auto_delete`, inclusiv `'expiry'`. */
export function retentionLabel(value: string | null | undefined): string {
  if (value == null) return 'Niciodată';
  if (value === 'expiry') return 'La data expirării';
  const fromOption = RETENTION_OPTIONS.find(o => o.value === value)?.label;
  if (fromOption) return fromOption;
  // Format fallback pentru valori custom (ex: `45d`).
  const m = value.match(/^(\d+)d$/);
  if (m) {
    const d = parseInt(m[1], 10);
    return `${d} zile`;
  }
  return value;
}
