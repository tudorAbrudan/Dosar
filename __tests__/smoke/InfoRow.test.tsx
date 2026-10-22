import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { InfoRow } from '@/components/settings/InfoRow';
import { SectionCard } from '@/components/settings/SectionCard';

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

  it('nu apelează onPress cât e busy', () => {
    const onPress = jest.fn();
    const { getByText } = render(<InfoRow {...baseProps} onPress={onPress} busy />);
    fireEvent.press(getByText('Securitate'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('comutatorul are eticheta rândului și transmite valoarea nouă', () => {
    const onSwitchChange = jest.fn();
    const { getByLabelText } = render(
      <InfoRow {...baseProps} switchValue={false} onSwitchChange={onSwitchChange} />
    );
    fireEvent(getByLabelText('Securitate'), 'valueChange', true);
    expect(onSwitchChange).toHaveBeenCalledWith(true);
  });

  it('rândul care deschide un panou își anunță starea', () => {
    const { getByRole } = render(<InfoRow {...baseProps} onPress={() => {}} expanded={false} />);
    expect(getByRole('button').props.accessibilityState).toMatchObject({ expanded: false });
  });
});

describe('SectionCard', () => {
  it('pliabilă: pornește închisă și se deschide la apăsarea titlului', () => {
    const { getByRole, queryByText } = render(
      <SectionCard title="Notificări" scheme="light" collapsible>
        <Text>conținut</Text>
      </SectionCard>
    );
    expect(queryByText('conținut')).toBeNull();
    fireEvent.press(getByRole('button', { name: 'Notificări' }));
    expect(queryByText('conținut')).toBeTruthy();
  });

  it('nepliabilă: conținutul se vede direct', () => {
    const { getByText } = render(
      <SectionCard title="Securitate" scheme="light">
        <Text>conținut</Text>
      </SectionCard>
    );
    expect(getByText('conținut')).toBeTruthy();
  });
});
