/* eslint-disable @typescript-eslint/no-var-requires */
const { countNonBlankLines, classify } = require('../../scripts/file-size-audit');

describe('file-size-audit', () => {
  it('counts non-blank lines', () => {
    expect(countNonBlankLines('a\n\nb\n  \nc')).toBe(3);
  });

  it('counts empty source as 0', () => {
    expect(countNonBlankLines('')).toBe(0);
    expect(countNonBlankLines('\n\n\n')).toBe(0);
  });

  it('classifies under warn threshold as ok', () => {
    expect(classify(300, 400, 800)).toBe('ok');
  });

  it('classifies at warn threshold as warn', () => {
    expect(classify(400, 400, 800)).toBe('warn');
  });

  it('classifies between warn and strict as warn', () => {
    expect(classify(500, 400, 800)).toBe('warn');
  });

  it('classifies at strict threshold as fail', () => {
    expect(classify(800, 400, 800)).toBe('fail');
  });

  it('classifies over strict as fail', () => {
    expect(classify(900, 400, 800)).toBe('fail');
  });
});
