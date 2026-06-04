import { MEDICAL_REDIRECT_RULE } from '@/services/chatbot';

describe('MEDICAL_REDIRECT_RULE — redirect static, fără scurgere', () => {
  it('îndrumă către Dosarul medical', () => {
    expect(MEDICAL_REDIRECT_RULE).toContain('Dosarul medical');
  });

  it('invocă motivul de confidențialitate/GDPR', () => {
    expect(MEDICAL_REDIRECT_RULE).toMatch(/confiden|GDPR/i);
  });

  it('instruiește explicit fără acces la documentele medicale', () => {
    expect(MEDICAL_REDIRECT_RULE).toMatch(/nu ai acces|fără acces/i);
  });

  it('e text static — fără interpolare rămasă (nicio scurgere per-document)', () => {
    expect(MEDICAL_REDIRECT_RULE).not.toContain('${');
  });

  it('clarifică faptul că funcționalitatea există, doar datele sunt restricționate', () => {
    expect(MEDICAL_REDIRECT_RULE).toMatch(/exclusiv din chat/i);
  });
});
