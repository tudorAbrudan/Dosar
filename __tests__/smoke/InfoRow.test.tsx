import { render, fireEvent } from '@testing-library/react-native';
import { InfoRow } from '@/components/settings/InfoRow';

describe('InfoRow', () => {
  const baseProps = {
    icon: 'lock-closed-outline' as const,
    iconBg: '#abc',
    iconColor: '#def',
    label: 'Securitate',
    scheme: 'light' as const,
  };

  it('randează label + sub-text', () => {
    const { getByText } = render(
      <InfoRow {...baseProps} sub="Activează blocarea" onPress={() => {}} />
    );
    expect(getByText('Securitate')).toBeTruthy();
    expect(getByText('Activează blocarea')).toBeTruthy();
  });

  it('apelează onPress când e clickable', () => {
    const onPress = jest.fn();
    const { getByText } = render(<InfoRow {...baseProps} onPress={onPress} />);
    fireEvent.press(getByText('Securitate'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('NU este interactiv fără onPress', () => {
    const { getByText } = render(<InfoRow {...baseProps} />);
    fireEvent.press(getByText('Securitate'));
    // No-op — nu aruncă, doar nu se întâmplă nimic.
  });

  it('aplică isLast fără borderBottom', () => {
    // Smoke: renderează cu isLast — nu validăm stilul direct, doar că nu crash
    const { getByText } = render(<InfoRow {...baseProps} isLast onPress={() => {}} />);
    expect(getByText('Securitate')).toBeTruthy();
  });
});
