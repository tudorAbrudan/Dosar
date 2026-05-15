/**
 * Paleta de culori pentru icon-uri (background + foreground) folosită
 * peste tot în InfoRow, banner-uri, action cards.
 *
 * Pattern Material Design: bg = light tint (50/100), fg = saturated (700/800/900).
 * Combinațiile sunt theme-neutral (light bg + dark fg) — funcționează pe ambele
 * teme; nu sunt din `theme/colors.ts` paleta dinamică ci sunt domain-specific
 * semantic colors per concept (info/warning/danger/...).
 *
 * Folosire:
 *   import { iconColors } from '@/theme/iconColors';
 *   <InfoRow iconBg={iconColors.info.bg} iconColor={iconColors.info.fg} ... />
 */

interface IconColorPair {
  bg: string;
  fg: string;
}

export const iconColors = {
  /** Verde — primary, success, identitate proprie. */
  primary: { bg: '#E8F5E9', fg: '#2E7D32' } as IconColorPair,
  /** Verde închis — succes accentuat. */
  primaryDark: { bg: '#E8F5E9', fg: '#388E3C' } as IconColorPair,
  /** Albastru — info, navigare, link-uri. */
  info: { bg: '#E3F2FD', fg: '#1565C0' } as IconColorPair,
  /** Albastru deschis — info secundar. */
  infoLight: { bg: '#E1F5FE', fg: '#0277BD' } as IconColorPair,
  /** Portocaliu — warning, vehicul, atenție medie. */
  warning: { bg: '#FFF3E0', fg: '#E65100' } as IconColorPair,
  /** Chihlimbar — warning soft, sparkle, evaluare. */
  amber: { bg: '#FFF8E1', fg: '#F57F17' } as IconColorPair,
  /** Chihlimbar deschis — note, hint-uri. */
  amberLight: { bg: '#FFF8E1', fg: '#F9A825' } as IconColorPair,
  /** Roșu — danger, ștergere, error critical. */
  danger: { bg: '#FFEBEE', fg: '#C62828' } as IconColorPair,
  /** Roz — variantă alternativă de danger (delete, sensitive). */
  pink: { bg: '#FCE4EC', fg: '#C62828' } as IconColorPair,
  /** Mov — secundar, card-uri bancare. */
  purple: { bg: '#F3E5F5', fg: '#7B1FA2' } as IconColorPair,
  /** Mov închis — AI, sparkles, magic. */
  aiPurple: { bg: '#EDE7F6', fg: '#4527A0' } as IconColorPair,
  /** Mov adânc — premium, special. */
  deepPurple: { bg: '#F3E5F5', fg: '#6A1B9A' } as IconColorPair,
  /** Indigo — business, firmă, professional. */
  indigo: { bg: '#E8EAF6', fg: '#283593' } as IconColorPair,
  /** Verde-albăstrui — teal, financiar, fluxuri. */
  teal: { bg: '#E0F2F1', fg: '#00695C' } as IconColorPair,
  /** Teal medium. */
  tealMedium: { bg: '#E0F2F1', fg: '#00897B' } as IconColorPair,
  /** Roz adânc — animale, copii. */
  deepPink: { bg: '#FCE4EC', fg: '#AD1457' } as IconColorPair,
  /** Roz medium. */
  pinkMedium: { bg: '#FCE4EC', fg: '#C2185B' } as IconColorPair,
  /** Neutru — placeholder, disabled, separator. */
  neutral: { bg: '#F5F5F5', fg: '#757575' } as IconColorPair,
  /** Portocaliu intens — facturi, focuri, urgență. */
  deepOrange: { bg: '#FFF3E0', fg: '#BF360C' } as IconColorPair,
  /** Roșu închis — asigurări personale, sensibil. */
  darkRed: { bg: '#FFEBEE', fg: '#8E0000' } as IconColorPair,
  /** Maro — text avertisment soft (banner beta, descriere). */
  brown: { bg: '#EFEBE9', fg: '#6D4C41' } as IconColorPair,
} as const;

/**
 * Constante texte/borduri grey — folosite pentru placeholder, hint text,
 * border subtil. Theme-neutral (apar similar pe ambele teme).
 */
export const greys = {
  text666: '#666',
  text757575: '#757575',
  text888: '#888',
  text999: '#999',
  border: '#eee',
} as const;
