import { DEFAULT_CONFIG, QUALITY_ORDER } from './constants';
import type {
  NetworkQuality,
  NetworkQualityClassificationContext,
  NetworkQualityConfig,
  NetworkQualityState,
  NetworkSnapshot,
  ProbeResult,
  QualitySource,
  QualityThresholds,
} from './types';

type Classification = Pick<
  NetworkQualityState,
  | 'quality'
  | 'qualitySource'
  | 'effectiveDownlinkKbps'
  | 'effectiveRttMs'
  | 'reasons'
>;

type ClassifierConfig = Pick<NetworkQualityConfig, 'thresholds' | 'probe'> &
  Partial<Pick<NetworkQualityConfig, 'validationGraceMs'>>;
type MetricQuality = Exclude<NetworkQuality, 'unknown' | 'offline'>;

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function downlinkTier(
  value: number,
  thresholds: QualityThresholds
): MetricQuality {
  if (value >= thresholds.excellent.minDownlinkKbps) return 'excellent';
  if (value >= thresholds.good.minDownlinkKbps) return 'good';
  if (value >= thresholds.moderate.minDownlinkKbps) return 'moderate';
  return 'poor';
}

function rttTier(value: number, thresholds: QualityThresholds): MetricQuality {
  if (value <= thresholds.excellent.maxRttMs) return 'excellent';
  if (value <= thresholds.good.maxRttMs) return 'good';
  if (value <= thresholds.moderate.maxRttMs) return 'moderate';
  return 'poor';
}

function worseQuality(
  first: MetricQuality,
  second: MetricQuality
): MetricQuality {
  const firstIndex = QUALITY_ORDER.indexOf(first);
  const secondIndex = QUALITY_ORDER.indexOf(second);
  return firstIndex <= secondIndex ? first : second;
}

function forcedClassification(
  quality: 'unknown' | 'offline' | 'poor',
  reason: string,
  qualitySource: QualitySource = 'none'
): Classification {
  return {
    quality,
    qualitySource,
    effectiveDownlinkKbps: null,
    effectiveRttMs: null,
    reasons: [reason],
  };
}

/**
 * Classifies a snapshot using a fresh active probe, an OS estimate, or a
 * cellular-generation heuristic. The function is pure and deterministic.
 */
export function classifyNetworkQuality(
  snapshot: NetworkSnapshot,
  probe: ProbeResult | null,
  config: ClassifierConfig = DEFAULT_CONFIG,
  now: number = Date.now(),
  context: NetworkQualityClassificationContext = {}
): Classification {
  if (!snapshot.isConnected) {
    return forcedClassification('offline', 'not-connected');
  }
  if (snapshot.isCaptivePortal === true) {
    return forcedClassification('poor', 'captive-portal');
  }

  const failure = context.lastProbeFailure ?? null;
  const failureTtlMs = context.probeFailureTtlMs ?? config.probe.resultTtlMs;
  if (
    failure !== null &&
    failure.transport === snapshot.transport &&
    now - failure.timestamp <= failureTtlMs &&
    (probe === null || failure.timestamp > probe.timestamp)
  ) {
    return forcedClassification(
      'poor',
      `probe failed: ${failure.code}`,
      'probe'
    );
  }

  if (snapshot.isValidated === false) {
    const networkChangedAt = context.networkChangedAt ?? null;
    const validationGraceMs =
      config.validationGraceMs ?? DEFAULT_CONFIG.validationGraceMs;
    if (
      networkChangedAt !== null &&
      now - networkChangedAt < validationGraceMs
    ) {
      return forcedClassification('unknown', 'validating');
    }
    return forcedClassification('poor', 'not-validated');
  }

  const reasons: string[] = [];
  let freshProbe: ProbeResult | null = null;
  if (probe !== null) {
    if (probe.transport !== snapshot.transport) {
      reasons.push('probe stale (transport changed)');
    } else if (
      now - probe.timestamp >
      (context.probeResultTtlMs ?? config.probe.resultTtlMs)
    ) {
      reasons.push('probe stale (expired)');
    } else {
      freshProbe = probe;
    }
  }

  const usedProbeDownlink = freshProbe?.downlinkKbps != null;
  const usedProbeRtt = freshProbe?.rttMs != null;
  const usedOsDownlink = !usedProbeDownlink && snapshot.downlinkKbps !== null;
  const effectiveDownlinkKbps =
    freshProbe?.downlinkKbps ?? snapshot.downlinkKbps ?? null;
  const effectiveRttMs = freshProbe?.rttMs ?? null;

  let qualitySource: QualitySource = 'none';
  if (usedProbeDownlink || usedProbeRtt) {
    qualitySource = 'probe';
  } else if (usedOsDownlink) {
    qualitySource = 'os-estimate';
  }

  let quality: MetricQuality | null = null;
  if (effectiveDownlinkKbps !== null) {
    const tier = downlinkTier(effectiveDownlinkKbps, config.thresholds);
    reasons.push(
      `downlink ${formatValue(effectiveDownlinkKbps)} kbps → ${tier}`
    );
    quality = tier;
  }
  if (effectiveRttMs !== null) {
    const tier = rttTier(effectiveRttMs, config.thresholds);
    reasons.push(`rtt ${formatValue(effectiveRttMs)} ms → ${tier}`);
    quality = quality === null ? tier : worseQuality(quality, tier);
  }

  if (quality !== null) {
    return {
      quality,
      qualitySource,
      effectiveDownlinkKbps,
      effectiveRttMs,
      reasons,
    };
  }

  const heuristicQuality =
    snapshot.cellularGeneration === '5g' || snapshot.cellularGeneration === '4g'
      ? 'good'
      : snapshot.cellularGeneration === '3g'
        ? 'moderate'
        : snapshot.cellularGeneration === '2g'
          ? 'poor'
          : null;

  if (heuristicQuality !== null) {
    reasons.push(
      `cellular generation ${snapshot.cellularGeneration} → ${heuristicQuality}`
    );
    return {
      quality: heuristicQuality,
      qualitySource: 'heuristic',
      effectiveDownlinkKbps: null,
      effectiveRttMs: null,
      reasons,
    };
  }

  reasons.push('no quality metrics available');
  return {
    quality: 'unknown',
    qualitySource: 'none',
    effectiveDownlinkKbps: null,
    effectiveRttMs: null,
    reasons,
  };
}

/** Returns whether a ranked quality tier meets or exceeds a minimum tier. */
export function isQualityAtLeast(
  quality: NetworkQuality,
  minimum: NetworkQuality
): boolean {
  if (quality === 'unknown' || minimum === 'unknown') return false;
  return QUALITY_ORDER.indexOf(quality) >= QUALITY_ORDER.indexOf(minimum);
}
