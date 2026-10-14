/* eslint-disable @typescript-eslint/no-var-requires */
const { auditSource } = require('../../scripts/medical-ai-guard-audit');

/**
 * Audit-ul verifică gate-ul la nivel de FUNCȚIE. Până la 2026-10-13 era la nivel
 * de fișier: `documente/add.tsx` avea guard pentru butonul manual, așa că
 * completarea automată din același fișier (`runAiOcrMapper` → `mapOcrWithAi`)
 * trimitea documente medicale în cloud nedetectată.
 */
describe('medical-ai-guard-audit', () => {
  it('prinde completarea automată fără gate, chiar dacă fișierul are guard în altă funcție', () => {
    const src = `
      export default function AddScreen() {
        async function handleManual() {
          const g = await ensureAiAnalysisAllowed({ docType });
          await extractFieldsWithLlm(text, img);
        }
        async function runAiOcrMapper(text) {
          const r = await mapOcrWithAi(text, entities);
        }
      }`;
    const v = auditSource('app/(tabs)/documente/add.tsx', src);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ fn: 'mapOcrWithAi', owner: 'runAiOcrMapper' });
  });

  it('acceptă completarea automată cu ensureAutoAiAllowed în aceeași funcție', () => {
    const src = `
      export default function AddScreen() {
        async function runAiOcrMapper(text) {
          const gate = await ensureAutoAiAllowed({ docType });
          if (!gate.allowed) return;
          const r = await mapOcrWithAi(text, entities);
        }
      }`;
    expect(auditSource('app/x.tsx', src)).toEqual([]);
  });

  it('prinde bonul de carburant fără getScanAiAccess', () => {
    const src = `
      export default function Fuel() {
        async function processReceiptOcr(text, img) {
          return mapFuelReceiptWithAi(text, img);
        }
      }`;
    expect(auditSource('app/fuel.tsx', src)).toHaveLength(1);
  });

  it('guard-ul din componenta de top NU acoperă funcțiile interioare', () => {
    const src = `
      export default function Screen() {
        useEffect(() => { void ensureAiAnalysisAllowed({ docType }); }, []);
        async function send() { await sendAiRequestWithImage(s, u, img); }
      }`;
    expect(auditSource('app/y.tsx', src)).toHaveLength(1);
  });

  it('classifyDocument e acoperit și de filterMedicalCandidatesForAi', () => {
    const src = `
      export default function Screen() {
        const handle = async () => {
          const c = await filterMedicalCandidatesForAi(base, links);
          await classifyDocument(text, img, c);
        };
      }`;
    expect(auditSource('app/z.tsx', src)).toEqual([]);
  });

  it('urcă prin callback-uri anonime până la funcția cu nume', () => {
    const src = `
      export default function Screen() {
        async function analyze(pages) {
          const g = await ensureAiAnalysisAllowed({ docType });
          await Promise.all(pages.map(async p => extractFieldsWithLlm(p.text, p.img)));
        }
      }`;
    expect(auditSource('app/w.tsx', src)).toEqual([]);
  });
});
