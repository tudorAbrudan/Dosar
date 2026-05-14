import { render, fireEvent } from '@testing-library/react-native';
import { AutoActivatedBanner } from '@/components/document/AutoActivatedBanner';

describe('AutoActivatedBanner', () => {
  it('randează label-ul tipului (Talon)', () => {
    const { getByText } = render(<AutoActivatedBanner type="talon" onDismiss={() => {}} />);
    expect(getByText(/Talon/i)).toBeTruthy();
    expect(getByText(/activat automat/i)).toBeTruthy();
  });

  it('apelează onDismiss la tap pe X', () => {
    const onDismiss = jest.fn();
    const { getByLabelText } = render(
      <AutoActivatedBanner type="buletin" onDismiss={onDismiss} />
    );
    fireEvent.press(getByLabelText('Închide notificarea'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('fallback la string-ul tipului dacă label-ul nu există', () => {
    // @ts-expect-error — testăm intenționat un tip neacoperit în labels
    const { getByText } = render(<AutoActivatedBanner type="unknown_type" onDismiss={() => {}} />);
    expect(getByText(/unknown_type/)).toBeTruthy();
  });
});
