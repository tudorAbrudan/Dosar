/**
 * Legătura reală spre chat-ul medical din chat-ul general. Înainte, redirect-ul
 * era doar o frază în prompt, fără nimic de apăsat.
 */
import {
  buildMedicalLinkBlock,
  isMedicalQuestion,
  MEDICAL_LINK_PREFIX,
  stripMedicalLinks,
} from '@/services/chatbot';

describe('isMedicalQuestion', () => {
  it.each([
    'Ce analize am făcut anul trecut?',
    'Cum e colesterolul meu?',
    'Ce rețetă am primit de la medic?',
    'Când am fost la spital?',
    'Care e TSH-ul?',
  ])('„%s" → medical', q => {
    expect(isMedicalQuestion(q)).toBe(true);
  });

  it.each(['Când expiră RCA-ul la Logan?', 'Ce vaccinuri are Rex?', 'Arată-mi facturile de gaz'])(
    '„%s" → nu e medical',
    q => {
      expect(isMedicalQuestion(q)).toBe(false);
    }
  );
});

describe('buildMedicalLinkBlock', () => {
  it('fără dosare → îndrumă spre crearea unuia', () => {
    const b = buildMedicalLinkBlock([]);
    expect(b.startsWith(MEDICAL_LINK_PREFIX)).toBe(true);
    expect(b).toMatch(/Dosare medicale/);
  });

  it('cu dosare → tag ENT de tip medical_record pentru fiecare (max 3)', () => {
    const b = buildMedicalLinkBlock([
      { id: 'r1', name: 'Ana' },
      { id: 'r2', name: 'Ion' },
      { id: 'r3', name: 'Maria' },
      { id: 'r4', name: 'Dan' },
    ]);
    expect(b).toContain('[ENT:Chat Ana|medical_record|r1]');
    expect(b).toContain('[ENT:Chat Maria|medical_record|r3]');
    expect(b).not.toContain('r4');
  });
});

describe('stripMedicalLinks', () => {
  it('scoate blocul din istoric — numele dosarelor nu ajung la AI-ul general', () => {
    const out = stripMedicalLinks([
      { role: 'user', content: 'Ce analize am?' },
      {
        role: 'assistant',
        content: `Nu am acces la ele.\n\n${buildMedicalLinkBlock([{ id: 'r1', name: 'Ana' }])}`,
      },
    ]);
    expect(out[1].content).toBe('Nu am acces la ele.');
    expect(JSON.stringify(out)).not.toContain('Ana');
  });
});
