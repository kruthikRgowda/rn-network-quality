import type { NativeNetworkSnapshot } from './NativeNetworkQuality';
import type {
  CellularGeneration,
  NetworkSnapshot,
  Transport,
  UnsatisfiedReason,
} from './types';

const TRANSPORTS = [
  'wifi',
  'cellular',
  'ethernet',
  'bluetooth',
  'vpn',
  'other',
  'none',
  'unknown',
] as const satisfies readonly Transport[];

const CELLULAR_GENERATIONS = [
  '2g',
  '3g',
  '4g',
  '5g',
] as const satisfies readonly CellularGeneration[];

const UNSATISFIED_REASONS = [
  'notAvailable',
  'cellularDenied',
  'wifiDenied',
  'localNetworkDenied',
  'vpnInactive',
  'unknown',
] as const satisfies readonly UnsatisfiedReason[];

function includes<T extends string>(
  values: readonly T[],
  value: string
): value is T {
  return values.some((candidate) => candidate === value);
}

/** Narrows a native snapshot to the stable public string unions. */
export function normalizeSnapshot(
  snapshot: NativeNetworkSnapshot
): NetworkSnapshot {
  const transport = includes(TRANSPORTS, snapshot.transport)
    ? snapshot.transport
    : 'unknown';
  const cellularGeneration =
    snapshot.cellularGeneration !== null &&
    includes(CELLULAR_GENERATIONS, snapshot.cellularGeneration)
      ? snapshot.cellularGeneration
      : null;
  const unsatisfiedReason =
    snapshot.unsatisfiedReason === null
      ? null
      : includes(UNSATISFIED_REASONS, snapshot.unsatisfiedReason)
        ? snapshot.unsatisfiedReason
        : 'unknown';

  return {
    isConnected: snapshot.isConnected,
    isValidated: snapshot.isValidated,
    isCaptivePortal: snapshot.isCaptivePortal,
    transport,
    isVpn: snapshot.isVpn,
    isExpensive: snapshot.isExpensive,
    isConstrained: snapshot.isConstrained,
    isRoaming: snapshot.isRoaming,
    downlinkKbps: snapshot.downlinkKbps,
    uplinkKbps: snapshot.uplinkKbps,
    signalStrength: snapshot.signalStrength,
    cellularGeneration,
    supportsIPv4: snapshot.supportsIPv4,
    supportsIPv6: snapshot.supportsIPv6,
    supportsDNS: snapshot.supportsDNS,
    unsatisfiedReason,
    timestamp: snapshot.timestamp,
  };
}
