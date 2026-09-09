import { stripErrorTurns, type ChatMessage } from '@/services/chatbot';

/**
 * Regresia „AI-ul răspunde cu eroarea la orice întrebare", 2026-09-09.
 *
 * Erorile se persistă ca mesaje `assistant` ca să păstreze alternarea în DB.
 * Trimise înapoi modelului, le citea ca pe propriile replici și continua în
 * registrul lor — la „Merge?" a fabricat un mesaj de indisponibilitate care nu
 * există nicăieri în cod.
 */
describe('stripErrorTurns', () => {
  const u = (content: string): ChatMessage => ({ role: 'user', content });
  const a = (content: string): ChatMessage => ({ role: 'assistant', content });
  const err = (content: string): ChatMessage => ({
    role: 'assistant',
    content,
    isError: true,
  });

  it('lasă neatins un istoric fără erori', () => {
    const h = [u('salut'), a('bună'), u('ce zi e?'), a('luni')];
    expect(stripErrorTurns(h)).toEqual(h);
  });

  it('scoate eroarea și întrebarea rămasă fără răspuns', () => {
    const h = [u('salut'), a('bună'), u('Merge?'), err('Serviciul AI e indisponibil.')];
    expect(stripErrorTurns(h)).toEqual([u('salut'), a('bună')]);
  });

  it('păstrează alternarea user/assistant după curățare', () => {
    const h = [u('prima'), a('răspuns'), u('a doua'), err('eroare'), u('a treia'), a('răspuns 3')];
    const out = stripErrorTurns(h);
    expect(out.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    // niciun rol nu se repetă consecutiv — altfel Mistral respinge cu 400
    out.forEach((m, i) => {
      if (i > 0) expect(m.role).not.toEqual(out[i - 1].role);
    });
  });

  it('tratează erori consecutive fără să șteargă răspunsuri valide', () => {
    const h = [u('î1'), a('r1'), u('î2'), err('e1'), u('î3'), err('e2')];
    expect(stripErrorTurns(h)).toEqual([u('î1'), a('r1')]);
  });

  it('nu cade dacă eroarea e primul mesaj', () => {
    const h = [err('eroare la pornire'), u('salut'), a('bună')];
    expect(stripErrorTurns(h)).toEqual([u('salut'), a('bună')]);
  });

  it('nu confundă un răspuns despre erori cu o eroare reală', () => {
    // fără flagul explicit, conținutul nu contează — nu ghicim după text
    const h = [u('ce înseamnă 429?'), a('Înseamnă că serviciul e indisponibil.')];
    expect(stripErrorTurns(h)).toEqual(h);
  });
});
