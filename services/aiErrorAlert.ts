/**
 * aiErrorAlert.ts — un singur mod de a arăta erorile AI utilizatorului.
 *
 * De ce există: mesajele de limită conțin linkul către ghidul „cum îți iei cheie
 * proprie", dar într-un `Alert.alert` nativ textul NU e apăsabil — userul ar
 * trebui să transcrie URL-ul de mână de pe ecran. Aici îl scoatem din text și îl
 * transformăm într-un buton.
 *
 * Folosește-l în locul lui `Alert.alert` pentru ORICE eroare venită din AI, ca
 * mesajul și butoanele să fie identice peste tot (chat, analiză document, OCR).
 */

import { Alert, Linking } from 'react-native';
import { AI_KEY_GUIDE_URL, humanizeAiError } from './aiProvider';

/**
 * Afișează eroarea AI, adăugând butonul „Deschide ghidul" când mesajul trimite
 * spre ghidul public. Titlul se alege automat: limită vs. eșec de analiză.
 *
 * @param e      Eroarea brută (se trece prin `humanizeAiError`).
 * @param extra  Text adăugat la final (ex. „completează manual câmpurile").
 */
export function showAiErrorAlert(e: unknown, extra?: string): void {
  const msg = humanizeAiError(e);
  const isLimit = msg.includes('limita') || msg.includes('limită');
  const hasGuide = msg.includes(AI_KEY_GUIDE_URL);

  // Linkul iese din corpul mesajului: rămâne doar ca buton, altfel apare de două
  // ori și lungește un text deja lung.
  const body = hasGuide ? msg.replace(AI_KEY_GUIDE_URL, '').replace(/\s+$/, '') : msg;
  const full = extra ? `${body}\n\n${extra}` : body;

  const buttons = hasGuide
    ? [
        {
          text: 'Deschide ghidul',
          onPress: () => {
            void Linking.openURL(AI_KEY_GUIDE_URL).catch(() => undefined);
          },
        },
        { text: 'OK', style: 'cancel' as const },
      ]
    : [{ text: 'OK' }];

  Alert.alert(isLimit ? 'Limită AI atinsă' : 'AI nu a putut analiza documentul', full, buttons);
}
