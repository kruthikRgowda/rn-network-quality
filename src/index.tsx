/** Purely classifies a network snapshot and optional active-probe result. */
export { classifyNetworkQuality, isQualityAtLeast } from './classify';

/** Default configuration and ranked quality tiers. */
export { DEFAULT_CONFIG, QUALITY_ORDER } from './constants';

/** Error type used by all package operations. */
export { NetworkQualityError } from './errors';

/** Public network-quality types. */
export type * from './types';
