import { AppState, type AppStateStatus } from 'react-native';

import NativeNetworkQuality, {
  type NativeMonitorOptions,
  type NativeNetworkSnapshot,
  type NativeProbeOptions,
  type NativeProbeResult,
} from './NativeNetworkQuality';
import { classifyNetworkQuality } from './classify';
import { DEFAULT_CONFIG } from './constants';
import { NetworkQualityError } from './errors';
import { normalizeSnapshot } from './normalize';
import type {
  DeepPartial,
  NetworkQualityConfig,
  NetworkQualityErrorCode,
  NetworkQualityState,
  NetworkSnapshot,
  ProbeConfig,
  ProbeResult,
} from './types';

const MIN_AUTO_PROBE_INTERVAL_MS = 15_000;
const TRANSPORT_CHANGE_DEBOUNCE_MS = 2_000;
const MAX_LATENCY_SAMPLES = 100;
const MAX_NATIVE_TIMEOUT_MS = 2_147_483_647;
const SUPPORTED_ERROR_CODES = new Set<NetworkQualityErrorCode>([
  'E_UNSUPPORTED',
  'E_OFFLINE',
  'E_INVALID_URL',
  'E_PROBE_TIMEOUT',
  'E_PROBE_FAILED',
  'E_PROBE_SKIPPED',
]);

type RemovableSubscription = { remove(): void };

/** Minimal native surface consumed by the TypeScript manager. */
export interface NetworkQualityNativeModule {
  getCurrentState(): Promise<NativeNetworkSnapshot>;
  startMonitoring(options: NativeMonitorOptions): void;
  stopMonitoring(): void;
  probe(options: NativeProbeOptions): Promise<NativeProbeResult>;
  onNetworkStateChange(
    listener: (snapshot: NativeNetworkSnapshot) => void
  ): RemovableSubscription;
}

/** Minimal AppState surface consumed by the TypeScript manager. */
export interface NetworkQualityAppState {
  readonly currentState: string | null | undefined;
  addEventListener(
    type: 'change',
    listener: (state: AppStateStatus) => void
  ): RemovableSubscription;
}

interface ListenerRecord {
  active: boolean;
  listener: (state: NetworkQualityState) => void;
}

interface ErrorLike {
  code?: unknown;
  message?: unknown;
}

function cloneProbeConfig(config: ProbeConfig): ProbeConfig {
  return { ...config };
}

function cloneConfig(config: NetworkQualityConfig): NetworkQualityConfig {
  return {
    ...config,
    thresholds: {
      excellent: { ...config.thresholds.excellent },
      good: { ...config.thresholds.good },
      moderate: { ...config.thresholds.moderate },
    },
    probe: cloneProbeConfig(config.probe),
    autoProbe: { ...config.autoProbe },
  };
}

function mergeConfig(
  current: NetworkQualityConfig,
  patch: DeepPartial<NetworkQualityConfig>
): NetworkQualityConfig {
  const valueOrCurrent = <T>(value: T | undefined, currentValue: T): T =>
    value === undefined ? currentValue : value;

  return {
    throttleMs: valueOrCurrent(patch.throttleMs, current.throttleMs),
    bandwidthChangeThresholdPct: valueOrCurrent(
      patch.bandwidthChangeThresholdPct,
      current.bandwidthChangeThresholdPct
    ),
    thresholds: {
      excellent: {
        minDownlinkKbps: valueOrCurrent(
          patch.thresholds?.excellent?.minDownlinkKbps,
          current.thresholds.excellent.minDownlinkKbps
        ),
        maxRttMs: valueOrCurrent(
          patch.thresholds?.excellent?.maxRttMs,
          current.thresholds.excellent.maxRttMs
        ),
      },
      good: {
        minDownlinkKbps: valueOrCurrent(
          patch.thresholds?.good?.minDownlinkKbps,
          current.thresholds.good.minDownlinkKbps
        ),
        maxRttMs: valueOrCurrent(
          patch.thresholds?.good?.maxRttMs,
          current.thresholds.good.maxRttMs
        ),
      },
      moderate: {
        minDownlinkKbps: valueOrCurrent(
          patch.thresholds?.moderate?.minDownlinkKbps,
          current.thresholds.moderate.minDownlinkKbps
        ),
        maxRttMs: valueOrCurrent(
          patch.thresholds?.moderate?.maxRttMs,
          current.thresholds.moderate.maxRttMs
        ),
      },
    },
    probe: {
      latencyUrl: valueOrCurrent(
        patch.probe?.latencyUrl,
        current.probe.latencyUrl
      ),
      downloadUrl: valueOrCurrent(
        patch.probe?.downloadUrl,
        current.probe.downloadUrl
      ),
      latencySamples: valueOrCurrent(
        patch.probe?.latencySamples,
        current.probe.latencySamples
      ),
      timeoutMs: valueOrCurrent(
        patch.probe?.timeoutMs,
        current.probe.timeoutMs
      ),
      resultTtlMs: valueOrCurrent(
        patch.probe?.resultTtlMs,
        current.probe.resultTtlMs
      ),
    },
    autoProbe: {
      enabled: valueOrCurrent(
        patch.autoProbe?.enabled,
        current.autoProbe.enabled
      ),
      intervalMs: valueOrCurrent(
        patch.autoProbe?.intervalMs,
        current.autoProbe.intervalMs
      ),
      onTransportChange: valueOrCurrent(
        patch.autoProbe?.onTransportChange,
        current.autoProbe.onTransportChange
      ),
      allowOnExpensive: valueOrCurrent(
        patch.autoProbe?.allowOnExpensive,
        current.autoProbe.allowOnExpensive
      ),
      allowOnConstrained: valueOrCurrent(
        patch.autoProbe?.allowOnConstrained,
        current.autoProbe.allowOnConstrained
      ),
    },
  };
}

function assertFiniteNumber(
  value: number,
  path: string,
  minimum: number,
  exclusiveMinimum = false
): void {
  const belowMinimum = exclusiveMinimum ? value <= minimum : value < minimum;
  if (!Number.isFinite(value) || belowMinimum) {
    const operator = exclusiveMinimum ? 'greater than' : 'at least';
    throw new TypeError(
      `${path} must be a finite number ${operator} ${minimum}`
    );
  }
}

function validateProbeConfig(config: ProbeConfig): void {
  if (typeof config.latencyUrl !== 'string' || config.latencyUrl.length === 0) {
    throw new TypeError('probe.latencyUrl must be a non-empty string');
  }
  if (
    config.downloadUrl !== null &&
    (typeof config.downloadUrl !== 'string' || config.downloadUrl.length === 0)
  ) {
    throw new TypeError('probe.downloadUrl must be null or a non-empty string');
  }
  if (
    !Number.isInteger(config.latencySamples) ||
    config.latencySamples < 1 ||
    config.latencySamples > MAX_LATENCY_SAMPLES
  ) {
    throw new TypeError(
      `probe.latencySamples must be an integer between 1 and ${MAX_LATENCY_SAMPLES}`
    );
  }
  assertFiniteNumber(config.timeoutMs, 'probe.timeoutMs', 0, true);
  if (config.timeoutMs > MAX_NATIVE_TIMEOUT_MS) {
    throw new TypeError(
      `probe.timeoutMs must be at most ${MAX_NATIVE_TIMEOUT_MS}`
    );
  }
  assertFiniteNumber(config.resultTtlMs, 'probe.resultTtlMs', 0);
}

function validateConfig(config: NetworkQualityConfig): NetworkQualityConfig {
  assertFiniteNumber(config.throttleMs, 'throttleMs', 0);
  assertFiniteNumber(
    config.bandwidthChangeThresholdPct,
    'bandwidthChangeThresholdPct',
    0
  );

  const { excellent, good, moderate } = config.thresholds;
  for (const [name, threshold] of Object.entries(config.thresholds)) {
    assertFiniteNumber(
      threshold.minDownlinkKbps,
      `thresholds.${name}.minDownlinkKbps`,
      0
    );
    assertFiniteNumber(threshold.maxRttMs, `thresholds.${name}.maxRttMs`, 0);
  }
  if (
    excellent.minDownlinkKbps < good.minDownlinkKbps ||
    good.minDownlinkKbps < moderate.minDownlinkKbps ||
    excellent.maxRttMs > good.maxRttMs ||
    good.maxRttMs > moderate.maxRttMs
  ) {
    throw new TypeError(
      'thresholds must be monotonic from excellent to good to moderate'
    );
  }

  validateProbeConfig(config.probe);
  assertFiniteNumber(config.autoProbe.intervalMs, 'autoProbe.intervalMs', 0);
  for (const [name, value] of Object.entries(config.autoProbe)) {
    if (name !== 'intervalMs' && typeof value !== 'boolean') {
      throw new TypeError(`autoProbe.${name} must be a boolean`);
    }
  }

  return {
    ...config,
    autoProbe: {
      ...config.autoProbe,
      intervalMs: Math.max(
        MIN_AUTO_PROBE_INTERVAL_MS,
        config.autoProbe.intervalMs
      ),
    },
  };
}

function stateEqualsIgnoringSnapshotTimestamp(
  first: NetworkQualityState,
  second: NetworkQualityState
): boolean {
  return (
    JSON.stringify({ ...first, timestamp: 0 }) ===
    JSON.stringify({ ...second, timestamp: 0 })
  );
}

function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as ErrorLike).message === 'string'
  ) {
    return (error as ErrorLike).message as string;
  }
  return typeof error === 'string' ? error : 'The network probe failed';
}

function wrapProbeError(error: unknown): NetworkQualityError {
  if (error instanceof NetworkQualityError) return error;

  const candidate =
    typeof error === 'object' && error !== null
      ? (error as ErrorLike).code
      : undefined;
  const code =
    typeof candidate === 'string' &&
    SUPPORTED_ERROR_CODES.has(candidate as NetworkQualityErrorCode)
      ? (candidate as NetworkQualityErrorCode)
      : 'E_PROBE_FAILED';
  return new NetworkQualityError(code, errorMessage(error), { cause: error });
}

function unsupportedError(): NetworkQualityError {
  return new NetworkQualityError(
    'E_UNSUPPORTED',
    'rn-network-quality is unavailable. Run pod install on iOS, enable the React Native New Architecture, and rebuild the app. Expo Go is not supported; use an Expo development build.'
  );
}

/** Coordinates the native module, cached state, listeners, and auto-probes. */
export class NetworkQualityManager {
  private readonly nativeModule: NetworkQualityNativeModule | null;
  private readonly appStateApi: NetworkQualityAppState;
  private config = cloneConfig(DEFAULT_CONFIG);
  private readonly listeners = new Set<ListenerRecord>();
  private nativeSubscription: RemovableSubscription | null = null;
  private appStateSubscription: RemovableSubscription | null = null;
  private latestSnapshot: NetworkSnapshot | null = null;
  private cachedState: NetworkQualityState | null = null;
  private lastProbe: ProbeResult | null = null;
  private lastProbeResultTtlMs: number | null = null;
  private inFlightProbe: Promise<ProbeResult> | null = null;
  private autoProbeInterval: ReturnType<typeof setInterval> | null = null;
  private transportDebounce: ReturnType<typeof setTimeout> | null = null;
  private appStateStatus: string | null | undefined;
  private stateVersion = 0;

  public constructor(
    nativeModule: NetworkQualityNativeModule | null = NativeNetworkQuality ??
      null,
    appStateApi: NetworkQualityAppState = AppState
  ) {
    this.nativeModule = nativeModule;
    this.appStateApi = appStateApi;
    this.appStateStatus = appStateApi.currentState;
  }

  /** Returns whether the native TurboModule is linked and available. */
  public isSupported(): boolean {
    return this.nativeModule !== null;
  }

  /** Deep-merges and validates runtime monitoring and probe configuration. */
  public configure(patch: DeepPartial<NetworkQualityConfig>): void {
    const nativeModule = this.requireNativeModule();
    const nextConfig = validateConfig(mergeConfig(this.config, patch));
    this.config = cloneConfig(nextConfig);
    this.reclassifyCachedSnapshot();

    if (this.listeners.size > 0) {
      this.refreshAutoProbeLifecycle();
      nativeModule.startMonitoring(this.nativeMonitorOptions());
    }
  }

  /** Returns a defensive copy of the active runtime configuration. */
  public getConfig(): NetworkQualityConfig {
    this.requireNativeModule();
    return cloneConfig(this.config);
  }

  /** Fetches, normalizes, classifies, and caches the current native snapshot. */
  public getNetworkQuality(): Promise<NetworkQualityState> {
    const nativeModule = this.requireNativeModule();
    return nativeModule
      .getCurrentState()
      .then((snapshot) => this.acceptNativeSnapshot(snapshot));
  }

  /** Adds a live-state listener and starts native monitoring when necessary. */
  public addNetworkQualityListener(
    listener: (state: NetworkQualityState) => void
  ): RemovableSubscription {
    const nativeModule = this.requireNativeModule();
    const record: ListenerRecord = { active: true, listener };
    const hadCachedState = this.cachedState !== null;
    const versionAtSubscription = this.stateVersion;
    this.listeners.add(record);

    if (this.listeners.size === 1) {
      try {
        this.nativeSubscription = nativeModule.onNetworkStateChange(
          (snapshot) => {
            this.acceptNativeSnapshot(snapshot);
          }
        );
        this.refreshAutoProbeLifecycle();
        nativeModule.startMonitoring(this.nativeMonitorOptions());
      } catch (error) {
        this.nativeSubscription?.remove();
        this.nativeSubscription = null;
        this.listeners.delete(record);
        this.stopAutoProbeLifecycle();
        throw error;
      }
    }

    if (hadCachedState) {
      queueMicrotask(() => {
        if (
          record.active &&
          this.cachedState !== null &&
          this.stateVersion === versionAtSubscription
        ) {
          record.listener(this.cachedState);
        }
      });
    }

    return {
      remove: () => {
        if (!record.active) return;
        record.active = false;
        this.listeners.delete(record);
        if (this.listeners.size === 0) {
          this.nativeSubscription?.remove();
          this.nativeSubscription = null;
          this.stopAutoProbeLifecycle();
          nativeModule.stopMonitoring();
        }
      },
    };
  }

  /** Runs one active probe, de-duplicating concurrent calls. */
  public probeNetwork(
    options: Partial<ProbeConfig> = {}
  ): Promise<ProbeResult> {
    const nativeModule = this.requireNativeModule();
    if (this.inFlightProbe !== null) return this.inFlightProbe;

    const probeConfig = { ...this.config.probe, ...options };
    validateProbeConfig(probeConfig);
    const transport = this.latestSnapshot?.transport ?? 'unknown';
    const nativeOptions: NativeProbeOptions = {
      latencyUrl: probeConfig.latencyUrl,
      downloadUrl: probeConfig.downloadUrl,
      latencySamples: probeConfig.latencySamples,
      timeoutMs: probeConfig.timeoutMs,
    };

    let nativeProbe: Promise<NativeProbeResult>;
    try {
      nativeProbe = nativeModule.probe(nativeOptions);
    } catch (error) {
      throw wrapProbeError(error);
    }

    let managedProbe: Promise<ProbeResult>;
    managedProbe = nativeProbe
      .then((result) => {
        const probeResult: ProbeResult = { ...result, transport };
        this.lastProbe = probeResult;
        this.lastProbeResultTtlMs = probeConfig.resultTtlMs;
        this.reclassifyCachedSnapshot();
        return probeResult;
      })
      .catch((error: unknown) => {
        throw wrapProbeError(error);
      })
      .finally(() => {
        if (this.inFlightProbe === managedProbe) this.inFlightProbe = null;
      });
    this.inFlightProbe = managedProbe;
    return managedProbe;
  }

  /** Returns the most recent successful active-probe result. */
  public getLastProbeResult(): ProbeResult | null {
    this.requireNativeModule();
    return this.lastProbe;
  }

  /** Returns the referentially stable state snapshot used by React. */
  public getCachedState(): NetworkQualityState | null {
    return this.cachedState;
  }

  private requireNativeModule(): NetworkQualityNativeModule {
    if (this.nativeModule === null) throw unsupportedError();
    return this.nativeModule;
  }

  private nativeMonitorOptions(): NativeMonitorOptions {
    return {
      throttleMs: this.config.throttleMs,
      bandwidthChangeThresholdPct: this.config.bandwidthChangeThresholdPct,
    };
  }

  private acceptNativeSnapshot(
    nativeSnapshot: NativeNetworkSnapshot
  ): NetworkQualityState {
    const snapshot = normalizeSnapshot(nativeSnapshot);
    const previousTransport = this.latestSnapshot?.transport;
    this.latestSnapshot = snapshot;
    const state = this.buildState(snapshot);
    const acceptedState = this.acceptState(state);

    if (
      previousTransport !== undefined &&
      previousTransport !== snapshot.transport
    ) {
      this.scheduleTransportChangeProbe();
    }
    return acceptedState;
  }

  private buildState(snapshot: NetworkSnapshot): NetworkQualityState {
    const classifierConfig =
      this.lastProbeResultTtlMs === null
        ? this.config
        : {
            ...this.config,
            probe: {
              ...this.config.probe,
              resultTtlMs: this.lastProbeResultTtlMs,
            },
          };
    return {
      ...snapshot,
      ...classifyNetworkQuality(snapshot, this.lastProbe, classifierConfig),
      lastProbe: this.lastProbe,
    };
  }

  private acceptState(state: NetworkQualityState): NetworkQualityState {
    if (
      this.cachedState !== null &&
      stateEqualsIgnoringSnapshotTimestamp(this.cachedState, state)
    ) {
      return this.cachedState;
    }

    this.cachedState = state;
    this.stateVersion += 1;
    for (const record of [...this.listeners]) {
      if (record.active) record.listener(state);
    }
    return state;
  }

  private reclassifyCachedSnapshot(): void {
    if (this.latestSnapshot !== null) {
      this.acceptState(this.buildState(this.latestSnapshot));
    }
  }

  private refreshAutoProbeLifecycle(): void {
    this.stopAutoProbeLifecycle();
    if (!this.config.autoProbe.enabled || this.listeners.size === 0) return;

    this.appStateStatus = this.appStateApi.currentState;
    this.appStateSubscription = this.appStateApi.addEventListener(
      'change',
      (state) => {
        this.appStateStatus = state;
        this.clearAutoProbeInterval();
        if (state !== 'active') {
          this.clearTransportDebounce();
          return;
        }
        this.startAutoProbeInterval();
      }
    );
    if (this.appStateStatus === 'active') this.startAutoProbeInterval();
  }

  private stopAutoProbeLifecycle(): void {
    this.clearAutoProbeInterval();
    this.clearTransportDebounce();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
  }

  private startAutoProbeInterval(): void {
    if (this.autoProbeInterval !== null) return;
    this.autoProbeInterval = setInterval(() => {
      this.runAutoProbe();
    }, this.config.autoProbe.intervalMs);
  }

  private clearAutoProbeInterval(): void {
    if (this.autoProbeInterval !== null) {
      clearInterval(this.autoProbeInterval);
      this.autoProbeInterval = null;
    }
  }

  private clearTransportDebounce(): void {
    if (this.transportDebounce !== null) {
      clearTimeout(this.transportDebounce);
      this.transportDebounce = null;
    }
  }

  private scheduleTransportChangeProbe(): void {
    if (
      !this.config.autoProbe.enabled ||
      !this.config.autoProbe.onTransportChange ||
      this.listeners.size === 0 ||
      this.appStateStatus !== 'active'
    ) {
      return;
    }

    this.clearTransportDebounce();
    this.transportDebounce = setTimeout(() => {
      this.transportDebounce = null;
      this.runAutoProbe();
    }, TRANSPORT_CHANGE_DEBOUNCE_MS);
  }

  private runAutoProbe(): void {
    const snapshot = this.latestSnapshot;
    if (
      !this.config.autoProbe.enabled ||
      this.listeners.size === 0 ||
      this.appStateStatus !== 'active' ||
      snapshot === null ||
      !snapshot.isConnected ||
      (snapshot.isExpensive && !this.config.autoProbe.allowOnExpensive) ||
      (snapshot.isConstrained && !this.config.autoProbe.allowOnConstrained)
    ) {
      return;
    }

    try {
      this.probeNetwork().catch(() => {
        // Automatic probes are best-effort and intentionally silent.
      });
    } catch {
      // Synchronous validation/native errors are also silent for auto-probes.
    }
  }
}

const manager = new NetworkQualityManager();

/** Internal render-time support assertion used by the React hooks. */
export function assertNetworkQualitySupported(): void {
  if (!manager.isSupported()) throw unsupportedError();
}

/** Returns whether the native TurboModule is linked and available. */
export function isSupported(): boolean {
  return manager.isSupported();
}

/** Deep-merges runtime options into the current configuration. */
export function configure(config: DeepPartial<NetworkQualityConfig>): void {
  manager.configure(config);
}

/** Returns a defensive copy of the current configuration. */
export function getConfig(): NetworkQualityConfig {
  return manager.getConfig();
}

/** Fetches the current network-quality state. */
export function getNetworkQuality(): Promise<NetworkQualityState> {
  return manager.getNetworkQuality();
}

/** Subscribes to live network-quality state changes. */
export function addNetworkQualityListener(
  listener: (state: NetworkQualityState) => void
): RemovableSubscription {
  return manager.addNetworkQualityListener(listener);
}

/** Runs an active latency and optional throughput probe. */
export function probeNetwork(
  options?: Partial<ProbeConfig>
): Promise<ProbeResult> {
  return manager.probeNetwork(options);
}

/** Returns the most recent successful active-probe result. */
export function getLastProbeResult(): ProbeResult | null {
  return manager.getLastProbeResult();
}

/** Internal stable snapshot getter used by `useSyncExternalStore`. */
export function getCachedNetworkQualityState(): NetworkQualityState | null {
  return manager.getCachedState();
}
