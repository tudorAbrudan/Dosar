import { Alert } from 'react-native';
import {
  isPastDate,
  promptAddExpiryReminder,
  promptAddEventReminder,
} from '@/services/calendarPrompt';

function isoToday(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(
    t.getDate()
  ).padStart(2, '0')}`;
}

describe('isPastDate', () => {
  it('true pentru o dată din trecut', () => {
    expect(isPastDate('2020-01-01')).toBe(true);
  });
  it('false pentru o dată viitoare', () => {
    expect(isPastDate('2999-12-31')).toBe(false);
  });
  it('false pentru azi (azi nu a „trecut")', () => {
    expect(isPastDate(isoToday())).toBe(false);
  });
  it('false pentru string gol / ne-parsabil (nu suprimă din greșeală)', () => {
    expect(isPastDate('')).toBe(false);
    expect(isPastDate('not-a-date')).toBe(false);
  });
});

describe('promptAddExpiryReminder — fără reminder pentru date trecute', () => {
  afterEach(() => jest.restoreAllMocks());

  it('data trecută → nu afișează Alert, rulează onDone direct', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDone = jest.fn();
    promptAddExpiryReminder({
      documentId: 'd1',
      docType: 'rca',
      expiryDate: '2020-01-01',
      entityName: undefined,
      note: undefined,
      onDone,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('data viitoare → afișează Alert (onDone rulează din butonul Alert, nu imediat)', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDone = jest.fn();
    promptAddExpiryReminder({
      documentId: 'd1',
      docType: 'rca',
      expiryDate: '2999-12-31',
      entityName: undefined,
      note: undefined,
      onDone,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('promptAddEventReminder — fără reminder pentru evenimente trecute', () => {
  afterEach(() => jest.restoreAllMocks());

  it('eveniment trecut → nu afișează Alert, rulează onDone', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDone = jest.fn();
    promptAddEventReminder({
      documentId: 'd1',
      eventDate: '2019-06-01',
      title: 'Concert',
      venue: undefined,
      note: undefined,
      onDone,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('eveniment viitor → afișează Alert', () => {
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onDone = jest.fn();
    promptAddEventReminder({
      documentId: 'd1',
      eventDate: '2999-01-01',
      title: 'Concert',
      venue: undefined,
      note: undefined,
      onDone,
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
