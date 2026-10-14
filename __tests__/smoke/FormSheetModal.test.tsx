// app/__tests__/smoke/FormSheetModal.test.tsx
// Butoanele din SheetHeader sunt icon-only (✕ / ✓) — textele există doar ca
// accessibilityLabel, deci le căutăm prin getByLabelText, nu getByText.
import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import { FormSheetModal } from '@/components/ui/FormSheetModal';

describe('FormSheetModal', () => {
  it('randează titlul și butoanele când e vizibil', () => {
    const { getByText, getByLabelText } = render(
      <FormSheetModal visible title="Titlu test" onClose={() => {}} onSave={() => {}}>
        <Text>Conținut</Text>
      </FormSheetModal>
    );

    expect(getByText('Titlu test')).toBeTruthy();
    expect(getByLabelText('Anulează')).toBeTruthy();
    expect(getByLabelText('Salvează')).toBeTruthy();
    expect(getByText('Conținut')).toBeTruthy();
  });

  it('apelează onClose la tap pe Anulează', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <FormSheetModal visible title="X" onClose={onClose} onSave={() => {}}>
        <Text>x</Text>
      </FormSheetModal>
    );

    fireEvent.press(getByLabelText('Anulează'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('apelează onSave la tap pe Salvează', () => {
    const onSave = jest.fn();
    const { getByLabelText } = render(
      <FormSheetModal visible title="X" onClose={() => {}} onSave={onSave}>
        <Text>x</Text>
      </FormSheetModal>
    );

    fireEvent.press(getByLabelText('Salvează'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('arată Salvez... și blochează ambele butoane când saving=true', () => {
    const onSave = jest.fn();
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <FormSheetModal visible title="X" onClose={onClose} onSave={onSave} saving>
        <Text>x</Text>
      </FormSheetModal>
    );

    fireEvent.press(getByLabelText('Salvez...'));
    fireEvent.press(getByLabelText('Anulează'));
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
