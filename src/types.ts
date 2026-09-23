/** The network interface carrying the default route. */
export type Transport =
  | 'wifi'
  | 'cellular'
  | 'ethernet'
  | 'bluetooth'
  | 'vpn'
  | 'other'
  | 'none'
  | 'unknown';

/** A coarse cellular radio generation reported by the operating system. */
export type CellularGeneration = '2g' | '3g' | '4g' | '5g';

/** The derived connection-quality tier. */
export type NetworkQuality =
  'unknown' | 'offline' | 'poor' | 'moderate' | 'good' | 'excellent';

/** The signal source that determined the current quality tier. */
export type QualitySource = 'probe' | 'os-estimate' | 'heuristic' | 'none';

/** The reason iOS reported an unsatisfied network path. */
export type UnsatisfiedReason =
  | 'notAvailable'
  | 'cellularDenied'
  | 'wifiDenied'
  | 'localNetworkDenied'
  | 'vpnInactive'
  | 'unknown';

/** Raw link signals reported by the operating system. `null` means unavailable. */
export interface NetworkSnapshot {
  /** Whether the default network can carry internet traffic. */
  isConnected: boolean;
  /** Whether the operating system validated internet access. */
  isValidated: boolean | null;
  /** Whether the operating system detected a captive portal. */
  isCaptivePortal: boolean | null;
  /** The interface carrying the default route. */
  transport: Transport;
  /** Whether a VPN transport is present, when detectable. */
  isVpn: boolean | null;
  /** Whether use of the connection may incur monetary or data cost. */
  isExpensive: boolean;
  /** Whether the user enabled a reduced-data mode. */
  isConstrained: boolean;
  /** Whether the cellular connection is roaming, when detectable. */
  isRoaming: boolean | null;
  /** Operating-system downstream bandwidth estimate in kilobits per second. */
  downlinkKbps: number | null;
  /** Operating-system upstream bandwidth estimate in kilobits per second. */
  uplinkKbps: number | null;
  /** Bearer-dependent signal-strength value reported by the operating system. */
  signalStrength: number | null;
  /** Coarse cellular radio generation, when available. */
  cellularGeneration: CellularGeneration | null;
  /** Whether the current route supports IPv4. */
  supportsIPv4: boolean | null;
  /** Whether the current route supports IPv6. */
  supportsIPv6: boolean | null;
  /** Whether the current route has DNS support. */
  supportsDNS: boolean | null;
  /** Why an iOS path is unsatisfied, when available. */
  unsatisfiedReason: UnsatisfiedReason | null;
  /** Milliseconds since the Unix epoch. */
  timestamp: number;
}

/** Measurements returned by an explicitly requested active network probe. */
export interface ProbeResult {
  /** Median round-trip time to the latency endpoint in milliseconds. */
  rttMs: number | null;
  /** Measured downstream throughput in kilobits per second. */
  downlinkKbps: number | null;
  /** Number of response-body bytes read during the throughput phase. */
  bytesReceived: number;
  /** Total probe duration in milliseconds. */
  durationMs: number;
  /** Transport active when the probe was run. */
  transport: Transport;
  /** Non-fatal throughput-phase error, if one occurred. */
  downloadError: string | null;
  /** Milliseconds since the Unix epoch. */
  timestamp: number;
}

/** A raw snapshot enriched with a classified quality tier and probe metadata. */
export interface NetworkQualityState extends NetworkSnapshot {
  /** The derived quality tier. */
  quality: NetworkQuality;
  /** The signal source used to derive `quality`. */
  qualitySource: QualitySource;
  /** Downstream value used by the classifier. */
  effectiveDownlinkKbps: number | null;
  /** Round-trip value used by the classifier. */
  effectiveRttMs: number | null;
  /** Most recent successful probe result. */
  lastProbe: ProbeResult | null;
  /** Human-readable classifier decisions, intended for diagnostics. */
  reasons: string[];
}

/** Boundaries for a single connection-quality tier. */
export interface TierThreshold {
  /** Minimum downstream bandwidth in kilobits per second. */
  minDownlinkKbps: number;
  /** Maximum round-trip time in milliseconds. */
  maxRttMs: number;
}

/** Configurable excellent, good, and moderate quality boundaries. */
export interface QualityThresholds {
  /** Excellent-quality boundaries. */
  excellent: TierThreshold;
  /** Good-quality boundaries. */
  good: TierThreshold;
  /** Moderate-quality boundaries. */
  moderate: TierThreshold;
}

/** Options controlling an active latency and throughput probe. */
export interface ProbeConfig {
  /** HTTP(S) endpoint used for latency samples. */
  latencyUrl: string;
  /** HTTP(S) payload endpoint, or `null` to skip throughput measurement. */
  downloadUrl: string | null;
  /** Retained latency samples (1–100), excluding one warm-up request. */
  latencySamples: number;
  /** Positive whole-probe timeout in milliseconds, capped at 2,147,483,647. */
  timeoutMs: number;
  /** Time for which a result may influence classification. */
  resultTtlMs: number;
}

/** Options controlling background-safe automatic probes. */
export interface AutoProbeConfig {
  /** Whether automatic probing is enabled. */
  enabled: boolean;
  /** Delay between automatic probes in milliseconds. */
  intervalMs: number;
  /** Whether a transport change schedules a probe. */
  onTransportChange: boolean;
  /** Whether automatic probes may run on expensive networks. */
  allowOnExpensive: boolean;
  /** Whether automatic probes may run on constrained networks. */
  allowOnConstrained: boolean;
}

/** Complete runtime configuration for monitoring, classification, and probing. */
export interface NetworkQualityConfig {
  /** Minimum interval between minor native signal updates. */
  throttleMs: number;
  /** Percentage change required for bandwidth or signal updates. */
  bandwidthChangeThresholdPct: number;
  /** Classifier boundaries. */
  thresholds: QualityThresholds;
  /** Active-probe defaults. */
  probe: ProbeConfig;
  /** Automatic-probe behavior. */
  autoProbe: AutoProbeConfig;
}

/** Error codes surfaced by native and JavaScript operations. */
export type NetworkQualityErrorCode =
  | 'E_UNSUPPORTED'
  | 'E_OFFLINE'
  | 'E_INVALID_URL'
  | 'E_PROBE_TIMEOUT'
  | 'E_PROBE_FAILED'
  | 'E_PROBE_SKIPPED';

/** Recursively optional object fields accepted by `configure`. */
export type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends object ? DeepPartial<T[Key]> : T[Key];
};
