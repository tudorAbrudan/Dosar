import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { DocumentDetailRow } from '@/components/DocumentDetailRow';

describe('DocumentDetailRow', () => {
  it('randează label și valoare în mod inline', () => {
    const { getByText } = render(<DocumentDetailRow label="Tip" value="Permis auto" />);
    expect(getByText('Tip')).toBeTruthy();
    expect(getByText('Permis auto')).toBeTruthy();
  });

  it('randează label deasupra când are children (stacked)', () => {
    const { getByText } = render(
      <DocumentDetailRow label="Notă">
        <Text>conținut bogat</Text>
      </DocumentDetailRow>
    );
    expect(getByText('Notă')).toBeTruthy();
    expect(getByText('conținut bogat')).toBeTruthy();
  });

  it('randează doar children fără label', () => {
    const { getByText, queryByText } = render(
      <DocumentDetailRow>
        <Text>standalone</Text>
      </DocumentDetailRow>
    );
    expect(getByText('standalone')).toBeTruthy();
    expect(queryByText('undefined')).toBeNull();
  });
});
