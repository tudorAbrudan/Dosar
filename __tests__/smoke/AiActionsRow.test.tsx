import { render, fireEvent } from '@testing-library/react-native';
import { AiActionsRow } from '@/components/document/AiActionsRow';

describe('AiActionsRow', () => {
  it('afișează spinner + label când busy', () => {
    const { getByText } = render(
      <AiActionsRow busy busyLabel="Analizez cu AI..." showAction={false} onAction={() => {}} />
    );
    expect(getByText('Analizez cu AI...')).toBeTruthy();
  });

  it('afișează butonul „Trimite documentul la AI" când showAction', () => {
    const { getByText } = render(
      <AiActionsRow busy={false} busyLabel="" showAction onAction={() => {}} />
    );
    expect(getByText(/Trimite documentul la AI/i)).toBeTruthy();
  });

  it('apelează onAction la tap', () => {
    const onAction = jest.fn();
    const { getByLabelText } = render(
      <AiActionsRow busy={false} busyLabel="" showAction onAction={onAction} />
    );
    fireEvent.press(getByLabelText('Trimite documentul la AI'));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('returnează null când nu e busy și showAction e false', () => {
    const { toJSON } = render(
      <AiActionsRow busy={false} busyLabel="" showAction={false} onAction={() => {}} />
    );
    expect(toJSON()).toBeNull();
  });

  it('busy ascunde butonul chiar dacă showAction e true', () => {
    const { queryByText } = render(
      <AiActionsRow busy busyLabel="Loading..." showAction onAction={() => {}} />
    );
    expect(queryByText(/Trimite documentul/i)).toBeNull();
  });
});
