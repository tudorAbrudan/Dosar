/**
 * Mesajele afișate când AI-ul e blocat de o limită.
 *
 * Raportat pe device 2026-09-04: fiecare cale avea alt mesaj. Chat-ul spunea doar
 * „Limită de utilizare atinsă la providerul AI. Încearcă mai târziu." — fără nicio
 * alternativă; analiza documentului trimitea în Setări fără să spună ce anume să
 * configureze. Utilizatorul rămânea blocat, fără să știe că poate folosi model
 * local sau cheie proprie.
 */
import {
  humanizeAiError,
  AI_UNLIMITED_HINT,
  AI_KEY_GUIDE_URL,
  DAILY_AI_LIMIT,
} from '@/services/aiProvider';

describe('limita zilnică', () => {
  it('e 10 interogări', () => {
    expect(DAILY_AI_LIMIT).toBe(10);
  });
});

describe('AI_UNLIMITED_HINT', () => {
  it('oferă ambele alternative, cu modelul local primul', () => {
    expect(AI_UNLIMITED_HINT).toContain('Model local');
    expect(AI_UNLIMITED_HINT).toContain('Cheie API proprie');
    expect(AI_UNLIMITED_HINT.indexOf('Model local')).toBeLessThan(
      AI_UNLIMITED_HINT.indexOf('Cheie API proprie')
    );
  });

  it('conține link către ghidul public', () => {
    expect(AI_UNLIMITED_HINT).toContain(AI_KEY_GUIDE_URL);
    expect(AI_KEY_GUIDE_URL).toContain('#cheie-api');
  });
});

describe('humanizeAiError — aceeași îndrumare peste tot', () => {
  const hint = (msg: string) => msg.includes('Model local') && msg.includes(AI_KEY_GUIDE_URL);

  it('429 (limita providerului) îndrumă spre alternative', () => {
    const out = humanizeAiError(new Error('Eroare AI (429): {"message":"Rate limit exceeded"}'));
    expect(hint(out)).toBe(true);
    // JSON-ul brut al providerului nu ajunge la user
    expect(out).not.toContain('Rate limit exceeded');
  });

  it('400 (refuz la analiza documentului) îndrumă spre alternative', () => {
    const out = humanizeAiError(new Error('Eroare AI (400): bad request'));
    expect(hint(out)).toBe(true);
  });

  it('402 (credit epuizat) îndrumă spre alternative', () => {
    expect(hint(humanizeAiError(new Error('Eroare AI (402): no credit')))).toBe(true);
  });

  it('401 rămâne despre cheia invalidă, fără îndrumarea de limită', () => {
    const out = humanizeAiError(new Error('Eroare AI (401): unauthorized'));
    expect(out).toContain('Cheie API invalidă');
    expect(out).not.toContain(AI_KEY_GUIDE_URL);
  });

  it('5xx rămâne despre indisponibilitate temporară', () => {
    const out = humanizeAiError(new Error('Eroare AI (503): unavailable'));
    expect(out).toContain('temporar indisponibil');
  });

  it('„Context is full" (model local) îndrumă spre cheie proprie', () => {
    // Mesajul brut al llama.cpp ajungea ca atare în interfață: englezesc și fără
    // nicio cale de ieșire. Raportat pe device 2026-09-04.
    const out = humanizeAiError(new Error('Context is full'));
    expect(out).not.toContain('Context is full');
    expect(out).toContain(AI_KEY_GUIDE_URL);
    expect(out).toContain('modelul local');
    // Sugerează și restrângerea întrebării, nu doar schimbarea providerului
    expect(out).toContain('mai scurtă');
  });

  it('acoperă și variantele de mesaj pentru depășirea contextului', () => {
    for (const raw of ['context length exceeded', 'too many tokens', 'Context Is Full']) {
      expect(humanizeAiError(new Error(raw))).toContain(AI_KEY_GUIDE_URL);
    }
  });

  it('erorile de rețea rămân neatinse', () => {
    expect(humanizeAiError(new Error('Network request failed'))).toContain('conexiune la internet');
  });
});
