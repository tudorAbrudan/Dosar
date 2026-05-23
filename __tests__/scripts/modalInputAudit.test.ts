/* eslint-disable @typescript-eslint/no-var-requires */
const { auditSource } = require('../../scripts/modal-input-audit');

describe('modal-input-audit', () => {
  it('passes Modal transparent without inputs', () => {
    const src = `<Modal transparent><View><Text>X</Text></View></Modal>`;
    expect(auditSource('components/Foo.tsx', src)).toEqual([]);
  });

  it('flags Modal transparent with TextInput', () => {
    const src = `<Modal transparent><TextInput /></Modal>`;
    const v = auditSource('components/Foo.tsx', src);
    expect(v).toHaveLength(1);
    expect(v[0].containedInputs).toContain('TextInput');
  });

  it('flags Modal transparent={true} with Switch', () => {
    const src = `<Modal transparent={true}><Switch value={x} /></Modal>`;
    expect(auditSource('components/Foo.tsx', src)).toHaveLength(1);
  });

  it('passes Modal without transparent (uses pageSheet default)', () => {
    const src = `<Modal><TextInput /></Modal>`;
    expect(auditSource('components/Foo.tsx', src)).toEqual([]);
  });

  it('skips allowlisted file AppLockPinModal', () => {
    const src = `<Modal transparent><TextInput /></Modal>`;
    expect(auditSource('components/AppLockPinModal.tsx', src)).toEqual([]);
  });

  it('detects DatePickerField as input', () => {
    const src = `<Modal transparent><DatePickerField value={x} /></Modal>`;
    expect(auditSource('components/Foo.tsx', src)[0]?.containedInputs).toContain(
      'DatePickerField'
    );
  });
});
