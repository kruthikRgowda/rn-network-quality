'use strict';

const React = require('react');

const DEFAULT_CONFIG = {
  throttleMs: 1_000,
  bandwidthChangeThresholdPct: 10,
  validationGraceMs: 10_000,
  thresholds: {
    excellent: { minDownlinkKbps: 20_000, maxRttMs: 50 },
    good: { minDownlinkKbps: 5_000, maxRttMs: 150 },
    moderate: { minDownlinkKbps: 1_000, maxRttMs: 400 },
  },
  probe: {
    latencyUrl: 'https://www.gstatic.com/generate_204',
    downloadUrl: 'https://speed.cloudflare.com/__down?bytes=3000000',
    latencySamples: 3,
    timeoutMs: 8_000,
    downloadMaxDurationMs: 3_000,
    downloadMaxBytes: 3_000_000,
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

const QUALITY_ORDER = ['offline', 'poor', 'moderate', 'good', 'excellent'];

class NetworkQualityError extends Error {
  constructor(code, message, options) {
    super(message);
    this.name = 'NetworkQualityError';
    this.code = code;
    this.cause = options?.cause;
  }
}

const GOOD_WIFI_STATE = {
  isConnected: true,
  isValidated: true,
  isCaptivePortal: false,
  transport: 'wifi',
  isVpn: false,
  isExpensive: false,
  isConstrained: false,
  isRoaming: false,
  downlinkKbps: 10_000,
  uplinkKbps: 5_000,
  signalStrength: null,
  cellularGeneration: null,
  supportsIPv4: true,
  supportsIPv6: true,
  supportsDNS: true,
  unsatisfiedReason: null,
  timestamp: 0,
  quality: 'good',
  qualitySource: 'os-estimate',
  effectiveDownlinkKbps: 10_000,
  effectiveRttMs: null,
  lastProbe: null,
  lastProbeFailure: null,
  reasons: ['downlink 10000 kbps → good'],
};

const GOOD_PROBE_RESULT = {
  rttMs: 75,
  downlinkKbps: 10_000,
  bytesReceived: 200_000,
  durationMs: 250,
  transport: 'wifi',
  downloadError: null,
  timestamp: 0,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

let config = clone(DEFAULT_CONFIG);
let lastProbe = null;

function classifyNetworkQuality(
  snapshot,
  probe,
  classifierConfig = config,
  now = Date.now(),
  context = {}
) {
  if (!snapshot.isConnected) {
    return classification('offline', 'none', null, null, ['not-connected']);
  }
  if (snapshot.isCaptivePortal === true) {
    return classification('poor', 'none', null, null, ['captive-portal']);
  }
  const failure = context.lastProbeFailure ?? null;
  if (
    failure !== null &&
    failure.transport === snapshot.transport &&
    now - failure.timestamp <=
      (context.probeFailureTtlMs ?? classifierConfig.probe.resultTtlMs) &&
    (probe === null || failure.timestamp > probe.timestamp)
  ) {
    return classification('poor', 'probe', null, null, [
      `probe failed: ${failure.code}`,
    ]);
  }
  if (snapshot.isValidated === false) {
    const networkChangedAt = context.networkChangedAt ?? null;
    if (
      networkChangedAt !== null &&
      now - networkChangedAt < classifierConfig.validationGraceMs
    ) {
      return classification('unknown', 'none', null, null, ['validating']);
    }
    return classification('poor', 'none', null, null, ['not-validated']);
  }

  const reasons = [];
  let freshProbe = null;
  if (probe !== null) {
    if (probe.transport !== snapshot.transport) {
      reasons.push('probe stale (transport changed)');
    } else if (
      now - probe.timestamp >
      (context.probeResultTtlMs ?? classifierConfig.probe.resultTtlMs)
    ) {
      reasons.push('probe stale (expired)');
    } else {
      freshProbe = probe;
    }
  }

  const usedProbeDownlink = freshProbe?.downlinkKbps != null;
  const usedProbeRtt = freshProbe?.rttMs != null;
  const downlink = freshProbe?.downlinkKbps ?? snapshot.downlinkKbps ?? null;
  const rtt = freshProbe?.rttMs ?? null;
  const tiers = [];
  if (downlink !== null) {
    const tier = downlinkTier(downlink, classifierConfig.thresholds);
    tiers.push(tier);
    reasons.push(`downlink ${downlink} kbps → ${tier}`);
  }
  if (rtt !== null) {
    const tier = rttTier(rtt, classifierConfig.thresholds);
    tiers.push(tier);
    reasons.push(`rtt ${rtt} ms → ${tier}`);
  }
  if (tiers.length > 0) {
    const quality = tiers.reduce((worst, tier) =>
      QUALITY_ORDER.indexOf(tier) < QUALITY_ORDER.indexOf(worst) ? tier : worst
    );
    return classification(
      quality,
      usedProbeDownlink || usedProbeRtt ? 'probe' : 'os-estimate',
      downlink,
      rtt,
      reasons
    );
  }

  const heuristic =
    snapshot.cellularGeneration === '4g' || snapshot.cellularGeneration === '5g'
      ? 'good'
      : snapshot.cellularGeneration === '3g'
        ? 'moderate'
        : snapshot.cellularGeneration === '2g'
          ? 'poor'
          : 'unknown';
  return classification(
    heuristic,
    heuristic === 'unknown' ? 'none' : 'heuristic',
    null,
    null,
    [
      heuristic === 'unknown'
        ? 'no quality metrics available'
        : `cellular generation ${snapshot.cellularGeneration} → ${heuristic}`,
    ]
  );
}

function classification(quality, qualitySource, downlink, rtt, reasons) {
  return {
    quality,
    qualitySource,
    effectiveDownlinkKbps: downlink,
    effectiveRttMs: rtt,
    reasons,
  };
}

function downlinkTier(value, thresholds) {
  if (value >= thresholds.excellent.minDownlinkKbps) return 'excellent';
  if (value >= thresholds.good.minDownlinkKbps) return 'good';
  if (value >= thresholds.moderate.minDownlinkKbps) return 'moderate';
  return 'poor';
}

function rttTier(value, thresholds) {
  if (value <= thresholds.excellent.maxRttMs) return 'excellent';
  if (value <= thresholds.good.maxRttMs) return 'good';
  if (value <= thresholds.moderate.maxRttMs) return 'moderate';
  return 'poor';
}

function isQualityAtLeast(quality, minimum) {
  if (quality === 'unknown' || minimum === 'unknown') return false;
  return QUALITY_ORDER.indexOf(quality) >= QUALITY_ORDER.indexOf(minimum);
}

function isSupported() {
  return true;
}

function configure(patch) {
  config = {
    ...config,
    ...patch,
    thresholds: {
      ...config.thresholds,
      ...patch.thresholds,
      excellent: {
        ...config.thresholds.excellent,
        ...patch.thresholds?.excellent,
      },
      good: { ...config.thresholds.good, ...patch.thresholds?.good },
      moderate: {
        ...config.thresholds.moderate,
        ...patch.thresholds?.moderate,
      },
    },
    probe: { ...config.probe, ...patch.probe },
    autoProbe: { ...config.autoProbe, ...patch.autoProbe },
  };
}

function getConfig() {
  return clone(config);
}

function getNetworkQuality() {
  return Promise.resolve(GOOD_WIFI_STATE);
}

function addNetworkQualityListener(listener) {
  let active = true;
  Promise.resolve().then(() => {
    if (active) listener(GOOD_WIFI_STATE);
  });
  return {
    remove() {
      active = false;
    },
  };
}

function probeNetwork() {
  lastProbe = GOOD_PROBE_RESULT;
  return Promise.resolve(GOOD_PROBE_RESULT);
}

function getLastProbeResult() {
  return lastProbe;
}

function useNetworkQuality() {
  return GOOD_WIFI_STATE;
}

function useNetworkProbe() {
  const mounted = React.useRef(true);
  const [isProbing, setIsProbing] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const probe = React.useCallback(async (options) => {
    setIsProbing(true);
    setError(null);
    try {
      const nextResult = await probeNetwork(options);
      if (mounted.current) setResult(nextResult);
      return nextResult;
    } catch (nextError) {
      if (mounted.current) setError(nextError);
      throw nextError;
    } finally {
      if (mounted.current) setIsProbing(false);
    }
  }, []);
  return { probe, isProbing, result, error };
}

module.exports = {
  DEFAULT_CONFIG,
  QUALITY_ORDER,
  NetworkQualityError,
  classifyNetworkQuality,
  isQualityAtLeast,
  isSupported,
  configure,
  getConfig,
  getNetworkQuality,
  addNetworkQualityListener,
  probeNetwork,
  getLastProbeResult,
  useNetworkQuality,
  useNetworkProbe,
};
