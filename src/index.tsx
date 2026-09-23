/** Purely classifies a network snapshot and optional active-probe result. */
export { classifyNetworkQuality, isQualityAtLeast } from './classify';

/** Default configuration and ranked quality tiers. */
export { DEFAULT_CONFIG, QUALITY_ORDER } from './constants';

/** Error type used by all package operations. */
export { NetworkQualityError } from './errors';

/** React hooks for live state and on-demand active probes. */
export { useNetworkProbe, useNetworkQuality } from './hooks';

/** Runtime configuration, snapshots, listeners, and active probing. */
export {
  addNetworkQualityListener,
  configure,
  getConfig,
  getLastProbeResult,
  getNetworkQuality,
  isSupported,
  probeNetwork,
} from './manager';

/** Public network-quality types. */
export type * from './types';
