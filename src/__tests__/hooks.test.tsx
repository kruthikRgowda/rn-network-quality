import { act, renderHook } from '@testing-library/react-native';

import { NetworkQualityError } from '../errors';
import { useNetworkProbe, useNetworkQuality } from '../hooks';
import type { NetworkQualityState, ProbeResult } from '../types';
import { probe, snapshot } from './fixtures';

let mockCachedState: NetworkQualityState | null = null;
let mockStoreListener: ((state: NetworkQualityState) => void) | null = null;
const mockRemove = jest.fn();
const mockAssertNetworkQualitySupported = jest.fn();
const mockAddNetworkQualityListener = jest.fn(
  (listener: (state: NetworkQualityState) => void) => {
    mockStoreListener = listener;
    return { remove: mockRemove };
  }
);
const mockProbeNetwork = jest.fn<Promise<ProbeResult>, [options?: object]>();

jest.mock('../manager', () => ({
  addNetworkQualityListener: (listener: (state: NetworkQualityState) => void) =>
    mockAddNetworkQualityListener(listener),
  assertNetworkQualitySupported: () => mockAssertNetworkQualitySupported(),
  getCachedNetworkQualityState: () => mockCachedState,
  probeNetwork: (options?: object) => mockProbeNetwork(options),
}));

interface Deferred<T> {
  promise: Promise<T>;
  reject(reason: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function state(): NetworkQualityState {
  return {
    ...snapshot({ downlinkKbps: 5_000 }),
    quality: 'good',
    qualitySource: 'os-estimate',
    effectiveDownlinkKbps: 5_000,
    effectiveRttMs: null,
    lastProbe: null,
    reasons: ['downlink 5000 kbps → good'],
  };
}

beforeEach(() => {
  mockCachedState = null;
  mockStoreListener = null;
  mockRemove.mockReset();
  mockAssertNetworkQualitySupported.mockReset();
  mockAddNetworkQualityListener.mockClear();
  mockProbeNetwork.mockReset();
});

describe('useNetworkQuality', () => {
  it('returns null, publishes state, and unsubscribes on unmount', () => {
    const { result, unmount } = renderHook(() => useNetworkQuality());
    expect(result.current).toBeNull();
    expect(mockAddNetworkQualityListener).toHaveBeenCalledTimes(1);

    const nextState = state();
    act(() => {
      mockCachedState = nextState;
      mockStoreListener?.(nextState);
    });
    expect(result.current).toBe(nextState);

    unmount();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it('throws E_UNSUPPORTED during render when native support is absent', () => {
    mockAssertNetworkQualitySupported.mockImplementation(() => {
      throw new NetworkQualityError(
        'E_UNSUPPORTED',
        'development build required'
      );
    });

    expect(() => renderHook(() => useNetworkQuality())).toThrow(
      expect.objectContaining({ code: 'E_UNSUPPORTED' })
    );
  });
});

describe('useNetworkProbe', () => {
  it('throws E_UNSUPPORTED during render when native support is absent', () => {
    mockAssertNetworkQualitySupported.mockImplementation(() => {
      throw new NetworkQualityError(
        'E_UNSUPPORTED',
        'development build required'
      );
    });

    expect(() => renderHook(() => useNetworkProbe())).toThrow(
      expect.objectContaining({ code: 'E_UNSUPPORTED' })
    );
  });

  it('tracks a successful probe and forwards options', async () => {
    const pending = deferred<ProbeResult>();
    const nextResult = probe();
    mockProbeNetwork.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useNetworkProbe());
    let returned!: Promise<ProbeResult>;

    act(() => {
      returned = result.current.probe({ latencySamples: 2 });
    });
    expect(result.current).toMatchObject({
      isProbing: true,
      result: null,
      error: null,
    });
    expect(mockProbeNetwork).toHaveBeenCalledWith({ latencySamples: 2 });

    await act(async () => {
      pending.resolve(nextResult);
      await returned;
    });
    expect(result.current).toMatchObject({
      isProbing: false,
      result: nextResult,
      error: null,
    });
  });

  it('exposes a NetworkQualityError and rethrows the same error', async () => {
    const expected = new NetworkQualityError('E_PROBE_TIMEOUT', 'too slow');
    mockProbeNetwork.mockRejectedValueOnce(expected);
    const { result } = renderHook(() => useNetworkProbe());
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.probe();
      } catch (error) {
        caught = error;
      }
    });
    expect(caught).toBe(expected);
    expect(result.current).toMatchObject({
      isProbing: false,
      result: null,
      error: expected,
    });
  });

  it('normalizes unknown failures', async () => {
    mockProbeNetwork.mockRejectedValueOnce(new Error('unexpected'));
    const { result } = renderHook(() => useNetworkProbe());

    await act(async () => {
      await result.current.probe().catch(() => {});
    });
    expect(result.current.error).toMatchObject({
      code: 'E_PROBE_FAILED',
      message: 'unexpected',
    });
  });

  it('ignores completion after unmount', async () => {
    const pending = deferred<ProbeResult>();
    mockProbeNetwork.mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(() => useNetworkProbe());
    let returned!: Promise<ProbeResult>;
    act(() => {
      returned = result.current.probe();
    });
    unmount();

    pending.resolve(probe());
    await returned;
    expect(result.current.result).toBeNull();
    expect(result.current.isProbing).toBe(true);
  });

  it('lets only the newest invocation update hook state', async () => {
    const first = deferred<ProbeResult>();
    const second = deferred<ProbeResult>();
    const firstResult = probe({ rttMs: 100 });
    const secondResult = probe({ rttMs: 200 });
    mockProbeNetwork
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useNetworkProbe());
    let firstPromise!: Promise<ProbeResult>;
    let secondPromise!: Promise<ProbeResult>;

    act(() => {
      firstPromise = result.current.probe();
      secondPromise = result.current.probe();
    });
    await act(async () => {
      first.resolve(firstResult);
      await firstPromise;
    });
    expect(result.current.isProbing).toBe(true);
    expect(result.current.result).toBeNull();

    await act(async () => {
      second.resolve(secondResult);
      await secondPromise;
    });
    expect(result.current.isProbing).toBe(false);
    expect(result.current.result).toBe(secondResult);
  });

  it('wraps non-Error failures with a generic message', async () => {
    mockProbeNetwork.mockRejectedValueOnce('failure');
    const { result } = renderHook(() => useNetworkProbe());

    await act(async () => {
      await result.current.probe().catch(() => {});
    });
    expect(result.current.error).toMatchObject({
      code: 'E_PROBE_FAILED',
      message: 'The network probe failed',
      cause: 'failure',
    });
  });
});
