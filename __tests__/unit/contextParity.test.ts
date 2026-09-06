/**
 * Paritate local ↔ remote.
 *
 * Scopul declarat: aceeași întrebare trebuie să meargă la fel pe model local ca
 * pe unul online. Diferența structurală nu e inteligența modelului, ci CÂT
 * context primește: `LOCAL_LIMITS` plafona la 6 documente indiferent de
 * fereastra reală a modelului, deci documentul care ținea răspunsul putea să nu
 * ajungă niciodată în context.
 *
 * Testele de aici verifică dimensionarea contextului — determinist, fără LLM.
 * Un răspuns greșit al modelului rămâne posibil; un context INCAPABIL să conțină
 * răspunsul nu mai trebuie să fie.
 */
import { computeLocalLimits } from '@/services/chatbot';

describe('computeLocalLimits — dimensionare după fereastra modelului', () => {
  it('rămâne la plafonul istoric pentru ferestre mici (≤8192)', () => {
    // Nu regresăm sub ce mergea deja; 8192 e bugetul pentru care a fost calibrat.
    expect(computeLocalLimits(8192).maxDocsFiltered).toBe(6);
    expect(computeLocalLimits(4096).maxDocsFiltered).toBe(6);
  });

  it('folosește fereastra mai mare a modelelor moderne', () => {
    // Gemma 4 E2B Q3 (12288) și Qwen 3.5 2B (16384) foloseau sub jumătate.
    expect(computeLocalLimits(12288).maxDocsFiltered).toBeGreaterThan(6);
    expect(computeLocalLimits(16384).maxDocsFiltered).toBeGreaterThan(
      computeLocalLimits(12288).maxDocsFiltered
    );
  });

  it('nu depășește niciodată plafonul remote (peste atât e risc de jetsam degeaba)', () => {
    for (const nCtx of [16384, 32768, 131072]) {
      expect(computeLocalLimits(nCtx).maxDocsFiltered).toBeLessThanOrEqual(40);
    }
  });

  it('cade elegant când nu e niciun model selectat', () => {
    expect(computeLocalLimits(null).maxDocsFiltered).toBe(6);
  });

  it('nu scade sub minim nici la ferestre absurd de mici', () => {
    expect(computeLocalLimits(1024).maxDocsFiltered).toBeGreaterThanOrEqual(6);
  });

  it('maxDocsFull și maxDocsFiltered rămân consistente', () => {
    for (const nCtx of [8192, 12288, 16384]) {
      const l = computeLocalLimits(nCtx);
      expect(l.maxDocsFull).toBe(l.maxDocsFiltered);
    }
  });

  it('Qwen 3.5 2B (16384) crește substanțial față de plafonul vechi', () => {
    // Reperul scopului: de la 6 documente la un multiplu clar, dar SIGUR.
    // Pragul reflectă rezerva MĂSURATĂ pentru appKnowledge (~5300 tokeni), nu una
    // presupusă. Dacă promptul fix se micșorează, valoarea crește — bine.
    const local = computeLocalLimits(16384).maxDocsFiltered;
    expect(local).toBeGreaterThanOrEqual(12);
  });

  it('impune un plafon DUR pe caractere, nu doar pe numărul de documente', () => {
    // Regresia din 2026-09-04: 36 de documente într-o fereastră de 16384 au produs
    // „Context is full" pe device — estimarea per document (300 tokeni) era prea
    // optimistă. Numărul de documente singur nu e o protecție suficientă.
    const l = computeLocalLimits(16384);
    expect(l.maxDocChars).toBeDefined();
    expect(l.maxDocChars!).toBeGreaterThan(0);
    // Bugetul de caractere trebuie să încapă în fereastră la ~2.5 char/token,
    // lăsând rezerva pentru appKnowledge + reguli + răspuns.
    expect(l.maxDocChars! / 2.5).toBeLessThanOrEqual(16384 - 4000);
  });

  it('plafonul de caractere crește odată cu fereastra', () => {
    expect(computeLocalLimits(16384).maxDocChars!).toBeGreaterThan(
      computeLocalLimits(12288).maxDocChars!
    );
  });

  it('estimarea per document acoperă un document plin', () => {
    // 500 caractere OCR + 500 note + antet ≈ 1100+ caractere. La 2.5 char/token
    // înseamnă ~440 tokeni — estimarea trebuie să fie PESTE atât, nu sub.
    const l = computeLocalLimits(16384);
    const perDocChars = l.maxDocChars! / l.maxDocsFiltered;
    expect(perDocChars).toBeGreaterThan(1100);
  });
});
