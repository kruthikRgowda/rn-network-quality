import type { NetworkQuality, NetworkQualityConfig } from './types';

/** Default monitoring, classifier, and probe configuration. */
export const DEFAULT_CONFIG: NetworkQualityConfig = {
  throttleMs: 1_000,
  bandwidthChangeThresholdPct: 10,
  thresholds: {
    excellent: { minDownlinkKbps: 20_000, maxRttMs: 50 },
    good: { minDownlinkKbps: 5_000, maxRttMs: 150 },
    moderate: { minDownlinkKbps: 1_000, maxRttMs: 400 },
  },
  probe: {
    latencyUrl: 'https://www.gstatic.com/generate_204',
    downloadUrl: 'https://speed.cloudflare.com/__down?bytes=1500000',
    latencySamples: 3,
    timeoutMs: 8_000,
    resultTtlMs: 60_000,
  },
  autoProbe: {
    enabled: false,
    intervalMs: 60_000,
    onTransportChange: true,
    allowOnExpensive: false,
    allowOnConstrained: false,
  },
};

/** Ranked quality tiers from worst to best. `unknown` is intentionally unranked. */
export const QUALITY_ORDER: NetworkQuality[] = [
  'offline',
  'poor',
  'moderate',
  'good',
  'excellent',
];

/** Error codes that can be returned by the package. */
export const ERROR_CODES = {
  unsupported: 'E_UNSUPPORTED',
  offline: 'E_OFFLINE',
  invalidUrl: 'E_INVALID_URL',
  probeTimeout: 'E_PROBE_TIMEOUT',
  probeFailed: 'E_PROBE_FAILED',
  probeSkipped: 'E_PROBE_SKIPPED',
} as const;
