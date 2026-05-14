import { render, fireEvent } from '@testing-library/react-native';
import { LegalModal } from '@/components/settings/LegalModal';

describe('LegalModal', () => {
  const baseProps = {
    title: 'Termeni și condiții',
    content: 'Conținut text legal...',
    scheme: 'light' as const,
  };

  it('randează titlul și conținutul când visible', () => {
    const { getByText } = render(
      <LegalModal {...baseProps} visible onClose={() => {}} />
    );
    expect(getByText('Termeni și condiții')).toBeTruthy();
    expect(getByText('Conținut text legal...')).toBeTruthy();
  });

  it('apelează onClose la tap pe X', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <LegalModal {...baseProps} visible onClose={onClose} />
    );
    fireEvent.press(getByLabelText('Închide'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
