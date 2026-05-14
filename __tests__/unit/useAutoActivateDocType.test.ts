import { renderHook, act, waitFor } from '@testing-library/react-native';
import { useAutoActivateDocType } from '@/hooks/useAutoActivateDocType';

const mockUpdate = jest.fn<Promise<void>, [string[]]>(() => Promise.resolve());
let mockVisible: string[] = ['altul', 'buletin'];

jest.mock('@/hooks/useVisibilitySettings', () => ({
  useVisibilitySettings: () => ({
    visibleEntityTypes: [],
    visibleDocTypes: mockVisible,
    loading: false,
    error: null,
    refresh: jest.fn(),
    updateVisibleEntityTypes: jest.fn(),
    updateVisibleDocTypes: mockUpdate,
  }),
}));

describe('useAutoActivateDocType', () => {
  beforeEach(() => {
    mockUpdate.mockClear();
    mockVisible = ['altul', 'buletin'];
  });

  it('activează un tip inactiv și expune autoActivatedType', async () => {
    const { result } = renderHook(() => useAutoActivateDocType());

    await act(async () => {
      await result.current.activateIfNeeded('talon', ['altul', 'buletin']);
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(['altul', 'buletin', 'talon']);
    expect(result.current.autoActivatedType).toBe('talon');
  });

  it('NU activează dacă tipul e deja în contextul vizibil', async () => {
    const { result } = renderHook(() => useAutoActivateDocType());

    await act(async () => {
      await result.current.activateIfNeeded('buletin', ['altul', 'buletin']);
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.current.autoActivatedType).toBeNull();
  });

  it('NU duplica în visibleDocTypes dacă tipul există deja în settings (doar context diferit)', async () => {
    mockVisible = ['altul', 'buletin', 'talon'];
    const { result } = renderHook(() => useAutoActivateDocType());

    // context vizibil = doar [altul, buletin] (filtru per-entitate) — talon NU e în context,
    // dar e în settings → nu re-apelăm updateVisibleDocTypes
    await act(async () => {
      await result.current.activateIfNeeded('talon', ['altul', 'buletin']);
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.current.autoActivatedType).toBe('talon');
  });

  it('auto-dismiss banner-ul după 5s', async () => {
    jest.useFakeTimers();
    const { result } = renderHook(() => useAutoActivateDocType());

    await act(async () => {
      await result.current.activateIfNeeded('talon', ['altul']);
    });
    expect(result.current.autoActivatedType).toBe('talon');

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    await waitFor(() => {
      expect(result.current.autoActivatedType).toBeNull();
    });

    jest.useRealTimers();
  });

  it('păstrează flow-ul fără banner dacă updateVisibleDocTypes aruncă', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('storage full'));
    const { result } = renderHook(() => useAutoActivateDocType());

    await act(async () => {
      await result.current.activateIfNeeded('talon', ['altul']);
    });

    expect(mockUpdate).toHaveBeenCalled();
    expect(result.current.autoActivatedType).toBeNull();
  });

  it('setAutoActivatedType manual permite dismiss imediat', async () => {
    const { result } = renderHook(() => useAutoActivateDocType());

    await act(async () => {
      await result.current.activateIfNeeded('talon', ['altul']);
    });
    expect(result.current.autoActivatedType).toBe('talon');

    act(() => {
      result.current.setAutoActivatedType(null);
    });

    expect(result.current.autoActivatedType).toBeNull();
  });
});
