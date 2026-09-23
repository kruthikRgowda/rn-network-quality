import type { AppStateStatus } from 'react-native';

import { DEFAULT_CONFIG } from '../constants';
import { NetworkQualityError } from '../errors';
import {
  NetworkQualityManager,
  addNetworkQualityListener,
  assertNetworkQualitySupported,
  configure,
  getCachedNetworkQualityState,
  getConfig,
  getLastProbeResult,
  getNetworkQuality,
  isSupported,
  probeNetwork,
  type NetworkQualityAppState,
  type NetworkQualityNativeModule,
} from '../manager';
import type {
  NativeMonitorOptions,
  NativeNetworkSnapshot,
  NativeProbeOptions,
  NativeProbeResult,
} from '../NativeNetworkQuality';
import type {
  DeepPartial,
  NetworkQualityConfig,
  NetworkSnapshot,
} from '../types';
import { snapshot } from './fixtures';

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

function nativeProbeResult(
  overrides: Partial<NativeProbeResult> = {}
): NativeProbeResult {
  return {
    rttMs: 40,
    downlinkKbps: 25_000,
    bytesReceived: 200_000,
    durationMs: 250,
    downloadError: null,
    timestamp: 2_000_000,
    ...overrides,
  };
}

function createNative(initialSnapshot = snapshot()) {
  const eventListeners = new Set<(value: NativeNetworkSnapshot) => void>();
  const eventRemove = jest.fn();
  const getCurrentState = jest.fn(
    async (): Promise<NativeNetworkSnapshot> => initialSnapshot
  );
  const startMonitoring = jest.fn((_options: NativeMonitorOptions): void => {});
  const stopMonitoring = jest.fn((): void => {});
  const probe = jest.fn(
    async (_options: NativeProbeOptions): Promise<NativeProbeResult> =>
      nativeProbeResult()
  );
  const onNetworkStateChange = jest.fn(
    (listener: (value: NativeNetworkSnapshot) => void) => {
      eventListeners.add(listener);
      return {
        remove: () => {
          eventRemove();
          eventListeners.delete(listener);
        },
      };
    }
  );
  const native: NetworkQualityNativeModule = {
    getCurrentState,
    startMonitoring,
    stopMonitoring,
    probe,
    onNetworkStateChange,
  };

  return {
    emitNative(value: NativeNetworkSnapshot) {
      for (const listener of [...eventListeners]) listener(value);
    },
    eventRemove,
    getCurrentState,
    native,
    onNetworkStateChange,
    probe,
    startMonitoring,
    stopMonitoring,
  };
}

function createAppState(initialState: AppStateStatus = 'active') {
  let currentState: AppStateStatus = initialState;
  const listeners = new Set<(value: AppStateStatus) => void>();
  const subscriptionRemove = jest.fn();
  const addEventListener = jest.fn(
    (_type: 'change', listener: (value: AppStateStatus) => void) => {
      listeners.add(listener);
      return {
        remove: () => {
          subscriptionRemove();
          listeners.delete(listener);
        },
      };
    }
  );
  const appState: NetworkQualityAppState = {
    get currentState() {
      return currentState;
    },
    addEventListener,
  };

  return {
    addEventListener,
    appState,
    emitAppState(value: AppStateStatus) {
      currentState = value;
      for (const listener of [...listeners]) listener(value);
    },
    subscriptionRemove,
  };
}

function createManager(initialSnapshot = snapshot()) {
  const native = createNative(initialSnapshot);
  const appState = createAppState();
  return {
    ...native,
    ...appState,
    manager: new NetworkQualityManager(native.native, appState.appState),
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('NetworkQualityManager support and monitoring', () => {
  it('routes the public singleton helpers through the unsupported manager', () => {
    expect(isSupported()).toBe(false);
    expect(getCachedNetworkQualityState()).toBeNull();
    expect(() => assertNetworkQualitySupported()).toThrow(
      'Expo Go is not supported'
    );
    expect(() => configure({})).toThrow('Expo Go is not supported');
    expect(() => getConfig()).toThrow('Expo Go is not supported');
    expect(() => getNetworkQuality()).toThrow('Expo Go is not supported');
    expect(() => addNetworkQualityListener(jest.fn())).toThrow(
      'Expo Go is not supported'
    );
    expect(() => probeNetwork()).toThrow('Expo Go is not supported');
    expect(() => getLastProbeResult()).toThrow('Expo Go is not supported');
  });

  it('reports unsupported and throws a helpful E_UNSUPPORTED error', () => {
    const manager = new NetworkQualityManager(null, createAppState().appState);
    const operations = [
      () => manager.configure({}),
      () => manager.getConfig(),
      () => manager.getNetworkQuality(),
      () => manager.addNetworkQualityListener(jest.fn()),
      () => manager.probeNetwork(),
      () => manager.getLastProbeResult(),
    ];

    expect(manager.isSupported()).toBe(false);
    for (const operation of operations) {
      expect(operation).toThrow(
        expect.objectContaining({
          code: 'E_UNSUPPORTED',
          message: expect.stringContaining('Expo Go is not supported'),
        })
      );
    }
  });

  it('starts on the first listener and stops once after the last removal', () => {
    const context = createManager();
    const listener = jest.fn();
    const first = context.manager.addNetworkQualityListener(listener);
    const second = context.manager.addNetworkQualityListener(listener);

    expect(context.manager.isSupported()).toBe(true);
    expect(context.onNetworkStateChange).toHaveBeenCalledTimes(1);
    expect(context.startMonitoring).toHaveBeenCalledWith({
      throttleMs: 1_000,
      bandwidthChangeThresholdPct: 10,
    });

    first.remove();
    first.remove();
    expect(context.stopMonitoring).not.toHaveBeenCalled();
    second.remove();
    second.remove();

    expect(context.eventRemove).toHaveBeenCalledTimes(1);
    expect(context.stopMonitoring).toHaveBeenCalledTimes(1);
  });

  it('rolls back the first subscription if monitoring fails to start', () => {
    const context = createManager();
    context.startMonitoring.mockImplementationOnce(() => {
      throw new Error('registration failed');
    });

    expect(() => context.manager.addNetworkQualityListener(jest.fn())).toThrow(
      'registration failed'
    );
    expect(context.eventRemove).toHaveBeenCalledTimes(1);

    const subscription = context.manager.addNetworkQualityListener(jest.fn());
    expect(context.onNetworkStateChange).toHaveBeenCalledTimes(2);
    subscription.remove();
  });

  it('keeps equivalent state referentially stable while ignoring timestamps', () => {
    const context = createManager();
    const listener = jest.fn();
    const subscription = context.manager.addNetworkQualityListener(listener);

    context.emitNative(snapshot({ downlinkKbps: 5_000, timestamp: 1 }));
    const firstState = context.manager.getCachedState();
    expect(firstState).toMatchObject({
      quality: 'good',
      qualitySource: 'os-estimate',
      timestamp: 1,
    });
    context.emitNative(snapshot({ downlinkKbps: 5_000, timestamp: 2 }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(context.manager.getCachedState()).toBe(firstState);
    expect(context.manager.getCachedState()?.timestamp).toBe(1);

    context.emitNative(snapshot({ downlinkKbps: 4_999, timestamp: 3 }));
    expect(listener).toHaveBeenCalledTimes(2);
    expect(context.manager.getCachedState()).not.toBe(firstState);
    subscription.remove();
  });

  it('delivers cached state to a new active subscriber on a microtask', async () => {
    const context = createManager();
    const first = context.manager.addNetworkQualityListener(jest.fn());
    context.emitNative(snapshot({ downlinkKbps: 5_000 }));

    const nextListener = jest.fn();
    const next = context.manager.addNetworkQualityListener(nextListener);
    await flushPromises();
    expect(nextListener).toHaveBeenCalledWith(context.manager.getCachedState());

    const removedListener = jest.fn();
    const removed = context.manager.addNetworkQualityListener(removedListener);
    removed.remove();
    await flushPromises();
    expect(removedListener).not.toHaveBeenCalled();

    first.remove();
    next.remove();
  });

  it('does not send a stale cached microtask after a newer event', async () => {
    const context = createManager();
    const first = context.manager.addNetworkQualityListener(jest.fn());
    context.emitNative(snapshot({ downlinkKbps: 5_000 }));

    const nextListener = jest.fn();
    const next = context.manager.addNetworkQualityListener(nextListener);
    context.emitNative(snapshot({ downlinkKbps: 1_000 }));
    await flushPromises();

    expect(nextListener).toHaveBeenCalledTimes(1);
    expect(nextListener).toHaveBeenLastCalledWith(
      expect.objectContaining({ downlinkKbps: 1_000 })
    );
    first.remove();
    next.remove();
  });

  it('fetches and normalizes current state without starting monitoring', async () => {
    const context = createManager(
      snapshot({
        transport: 'wifi',
        cellularGeneration: null,
        unsatisfiedReason: null,
        downlinkKbps: 20_000,
      })
    );
    const first = await context.manager.getNetworkQuality();
    const second = await context.manager.getNetworkQuality();

    expect(first).toMatchObject({ quality: 'excellent', transport: 'wifi' });
    expect(second).toBe(first);
    expect(context.startMonitoring).not.toHaveBeenCalled();
  });
});

describe('NetworkQualityManager configuration', () => {
  it('deep-merges, clamps, defensively copies, reclassifies, and restarts', () => {
    const context = createManager();
    const listener = jest.fn();
    const subscription = context.manager.addNetworkQualityListener(listener);
    context.emitNative(snapshot({ downlinkKbps: 5_000 }));
    const patch: DeepPartial<NetworkQualityConfig> = {
      throttleMs: 250,
      thresholds: { good: { minDownlinkKbps: 6_000 } },
      probe: { timeoutMs: 4_000 },
      autoProbe: { intervalMs: 100 },
    };

    context.manager.configure(patch);
    const configured = context.manager.getConfig();
    expect(configured).toMatchObject({
      throttleMs: 250,
      bandwidthChangeThresholdPct: 10,
      thresholds: {
        excellent: DEFAULT_CONFIG.thresholds.excellent,
        good: { minDownlinkKbps: 6_000, maxRttMs: 150 },
        moderate: DEFAULT_CONFIG.thresholds.moderate,
      },
      probe: { timeoutMs: 4_000, latencySamples: 3 },
      autoProbe: { intervalMs: 15_000 },
    });
    expect(context.manager.getCachedState()?.quality).toBe('moderate');
    expect(context.startMonitoring).toHaveBeenLastCalledWith({
      throttleMs: 250,
      bandwidthChangeThresholdPct: 10,
    });
    expect(context.startMonitoring).toHaveBeenCalledTimes(2);

    configured.thresholds.good.minDownlinkKbps = 1;
    configured.probe.timeoutMs = 1;
    expect(context.manager.getConfig().thresholds.good.minDownlinkKbps).toBe(
      6_000
    );
    expect(context.manager.getConfig().probe.timeoutMs).toBe(4_000);
    subscription.remove();
  });

  it.each([
    [{ throttleMs: -1 }, 'throttleMs'],
    [
      { bandwidthChangeThresholdPct: Number.NaN },
      'bandwidthChangeThresholdPct',
    ],
    [{ thresholds: { excellent: { minDownlinkKbps: 4_000 } } }, 'monotonic'],
    [{ thresholds: { good: { maxRttMs: 25 } } }, 'monotonic'],
    [{ thresholds: { moderate: { maxRttMs: -1 } } }, 'maxRttMs'],
    [{ probe: { latencyUrl: '' } }, 'latencyUrl'],
    [{ probe: { downloadUrl: '' } }, 'downloadUrl'],
    [{ probe: { latencySamples: 1.5 } }, 'latencySamples'],
    [{ probe: { latencySamples: 0 } }, 'latencySamples'],
    [{ probe: { timeoutMs: 0 } }, 'timeoutMs'],
    [{ probe: { resultTtlMs: -1 } }, 'resultTtlMs'],
    [{ autoProbe: { intervalMs: -1 } }, 'intervalMs'],
    [{ autoProbe: { enabled: 'yes' } }, 'enabled'],
  ] as [DeepPartial<NetworkQualityConfig>, string][])(
    'rejects invalid configuration %o',
    (patch, message) => {
      const context = createManager();
      expect(() => context.manager.configure(patch)).toThrow(message);
      expect(context.manager.getConfig()).toEqual(DEFAULT_CONFIG);
    }
  );

  it('validates per-call probe options before calling native code', () => {
    const context = createManager();
    expect(() => context.manager.probeNetwork({ latencySamples: 0 })).toThrow(
      TypeError
    );
    expect(context.probe).not.toHaveBeenCalled();
  });
});

describe('NetworkQualityManager probes', () => {
  it('de-duplicates concurrent probes and captures transport before native work', async () => {
    const context = createManager();
    const listener = jest.fn();
    const subscription = context.manager.addNetworkQualityListener(listener);
    context.emitNative(
      snapshot({ transport: 'cellular', downlinkKbps: 1_000 })
    );
    const pending = deferred<NativeProbeResult>();
    context.probe.mockReturnValueOnce(pending.promise);

    const first = context.manager.probeNetwork({
      latencyUrl: 'https://latency.example',
      downloadUrl: null,
      latencySamples: 5,
      timeoutMs: 3_000,
    });
    context.emitNative(snapshot({ transport: 'wifi', downlinkKbps: 1_000 }));
    const second = context.manager.probeNetwork({ latencySamples: 0 });

    expect(second).toBe(first);
    expect(context.probe).toHaveBeenCalledTimes(1);
    expect(context.probe).toHaveBeenCalledWith({
      latencyUrl: 'https://latency.example',
      downloadUrl: null,
      latencySamples: 5,
      timeoutMs: 3_000,
    });

    pending.resolve(nativeProbeResult({ rttMs: 200 }));
    const result = await first;
    expect(result.transport).toBe('cellular');
    expect(context.manager.getLastProbeResult()).toBe(result);
    expect(context.manager.getCachedState()).toMatchObject({
      lastProbe: result,
      quality: 'moderate',
      reasons: expect.arrayContaining(['probe stale (transport changed)']),
    });

    await context.manager.probeNetwork();
    expect(context.probe).toHaveBeenCalledTimes(2);
    subscription.remove();
  });

  it.each([
    [{ code: 'E_PROBE_TIMEOUT', message: 'too slow' }, 'E_PROBE_TIMEOUT'],
    [{ code: 'E_OFFLINE', message: 'offline' }, 'E_OFFLINE'],
    [{ code: 'future', message: 'unknown failure' }, 'E_PROBE_FAILED'],
    ['plain failure', 'E_PROBE_FAILED'],
    [42, 'E_PROBE_FAILED'],
  ] as [unknown, string][])(
    'wraps rejected native error %o',
    async (nativeError, expectedCode) => {
      const context = createManager();
      context.probe.mockRejectedValueOnce(nativeError);

      await expect(context.manager.probeNetwork()).rejects.toMatchObject({
        name: 'NetworkQualityError',
        code: expectedCode,
      });
      await expect(context.manager.probeNetwork()).resolves.toBeDefined();
      expect(context.probe).toHaveBeenCalledTimes(2);
    }
  );

  it('preserves NetworkQualityError and wraps synchronous native failures', async () => {
    const context = createManager();
    const existing = new NetworkQualityError('E_INVALID_URL', 'bad endpoint');
    context.probe.mockRejectedValueOnce(existing);
    await expect(context.manager.probeNetwork()).rejects.toBe(existing);

    context.probe.mockImplementationOnce(() => {
      throw { code: 'E_INVALID_URL', message: 'invalid' };
    });
    expect(() => context.manager.probeNetwork()).toThrow(
      expect.objectContaining({
        code: 'E_INVALID_URL',
        cause: expect.anything(),
      })
    );
  });
});

describe('NetworkQualityManager auto-probing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs only while active and resumes its interval on foreground', async () => {
    const context = createManager();
    context.manager.configure({
      autoProbe: { enabled: true, intervalMs: 1_000 },
    });
    const subscription = context.manager.addNetworkQualityListener(jest.fn());
    context.emitNative(snapshot());

    expect(context.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
    jest.advanceTimersByTime(14_999);
    expect(context.probe).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(context.probe).toHaveBeenCalledTimes(1);
    await flushPromises();

    context.emitAppState('background');
    jest.advanceTimersByTime(30_000);
    expect(context.probe).toHaveBeenCalledTimes(1);
    context.emitAppState('active');
    jest.advanceTimersByTime(15_000);
    expect(context.probe).toHaveBeenCalledTimes(2);
    await flushPromises();

    subscription.remove();
    expect(context.subscriptionRemove).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(30_000);
    expect(context.probe).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ isConnected: false }, {}],
    [{ isExpensive: true }, {}],
    [{ isConstrained: true }, {}],
  ] as [Partial<NetworkSnapshot>, DeepPartial<NetworkQualityConfig>][])(
    'skips an unsafe automatic probe for %o',
    (overrides, extraConfig) => {
      const context = createManager();
      context.manager.configure({
        ...extraConfig,
        autoProbe: { enabled: true, intervalMs: 15_000 },
      });
      const subscription = context.manager.addNetworkQualityListener(jest.fn());
      context.emitNative(snapshot(overrides));

      jest.advanceTimersByTime(15_000);
      expect(context.probe).not.toHaveBeenCalled();
      subscription.remove();
    }
  );

  it('allows expensive and constrained probes when explicitly configured', async () => {
    const context = createManager();
    context.manager.configure({
      autoProbe: {
        enabled: true,
        intervalMs: 15_000,
        allowOnExpensive: true,
        allowOnConstrained: true,
      },
    });
    const subscription = context.manager.addNetworkQualityListener(jest.fn());
    context.emitNative(snapshot({ isExpensive: true, isConstrained: true }));

    jest.advanceTimersByTime(15_000);
    expect(context.probe).toHaveBeenCalledTimes(1);
    await flushPromises();
    subscription.remove();
  });

  it('debounces transport changes for two seconds and captures the latest one', async () => {
    const context = createManager();
    context.manager.configure({
      autoProbe: {
        enabled: true,
        intervalMs: 60_000,
        onTransportChange: true,
      },
    });
    const subscription = context.manager.addNetworkQualityListener(jest.fn());
    context.emitNative(snapshot({ transport: 'wifi' }));
    context.emitNative(snapshot({ transport: 'cellular' }));
    jest.advanceTimersByTime(1_999);
    expect(context.probe).not.toHaveBeenCalled();

    context.emitNative(snapshot({ transport: 'ethernet' }));
    jest.advanceTimersByTime(1_999);
    expect(context.probe).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(context.probe).toHaveBeenCalledTimes(1);
    await expect(context.probe.mock.results[0]?.value).resolves.toBeDefined();
    await flushPromises();
    expect(context.manager.getLastProbeResult()?.transport).toBe('ethernet');
    subscription.remove();
  });

  it('cancels a pending transport probe in background and when disabled', () => {
    const context = createManager();
    context.manager.configure({ autoProbe: { enabled: true } });
    const subscription = context.manager.addNetworkQualityListener(jest.fn());
    context.emitNative(snapshot({ transport: 'wifi' }));
    context.emitNative(snapshot({ transport: 'cellular' }));
    context.emitAppState('background');
    jest.advanceTimersByTime(2_000);
    expect(context.probe).not.toHaveBeenCalled();

    context.emitAppState('active');
    context.manager.configure({ autoProbe: { enabled: false } });
    context.emitNative(snapshot({ transport: 'ethernet' }));
    jest.advanceTimersByTime(2_000);
    expect(context.probe).not.toHaveBeenCalled();
    subscription.remove();
  });

  it('silences asynchronous and synchronous automatic probe failures', async () => {
    const context = createManager();
    context.manager.configure({ autoProbe: { enabled: true } });
    const subscription = context.manager.addNetworkQualityListener(jest.fn());
    context.emitNative(snapshot());
    context.probe.mockRejectedValueOnce(new Error('async failure'));
    jest.advanceTimersByTime(60_000);
    await flushPromises();

    context.probe.mockImplementationOnce(() => {
      throw new Error('sync failure');
    });
    jest.advanceTimersByTime(60_000);
    expect(context.probe).toHaveBeenCalledTimes(2);
    subscription.remove();
  });

  it('does not start an interval when the app begins in background', () => {
    const native = createNative();
    const appState = createAppState('background');
    const manager = new NetworkQualityManager(native.native, appState.appState);
    manager.configure({ autoProbe: { enabled: true } });
    const subscription = manager.addNetworkQualityListener(jest.fn());
    native.emitNative(snapshot());

    jest.advanceTimersByTime(120_000);
    expect(native.probe).not.toHaveBeenCalled();
    subscription.remove();
  });
});
