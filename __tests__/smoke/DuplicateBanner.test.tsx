import { render, fireEvent } from '@testing-library/react-native';
import { DuplicateBanner } from '@/components/document/DuplicateBanner';
import type { Document } from '@/types';

const baseDoc: Document = {
  id: 'doc-1',
  type: 'talon',
  issue_date: '2024-01-15',
  expiry_date: null,
  note: null,
  private_notes: null,
  metadata: {},
  entity_links: [],
  pages: [],
  file_path: null,
  created_at: '2024-01-15T00:00:00Z',
  updated_at: '2024-01-15T00:00:00Z',
} as unknown as Document;

describe('DuplicateBanner', () => {
  it('afișează tipul, data emiterii și CTA', () => {
    const { getByText } = render(<DuplicateBanner doc={baseDoc} onPress={() => {}} />);
    expect(getByText(/Document similar/i)).toBeTruthy();
    expect(getByText(/Talon/i)).toBeTruthy();
    expect(getByText(/2024-01-15/)).toBeTruthy();
    expect(getByText(/Deschide documentul existent/i)).toBeTruthy();
  });

  it('apelează onPress la tap pe banner', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(<DuplicateBanner doc={baseDoc} onPress={onPress} />);
    fireEvent.press(getByLabelText('Deschide documentul similar'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('omite data emiterii dacă nu există', () => {
    const docNoDate: Document = { ...baseDoc, issue_date: undefined };
    const { queryByText } = render(<DuplicateBanner doc={docNoDate} onPress={() => {}} />);
    expect(queryByText(/2024/)).toBeNull();
  });
});
