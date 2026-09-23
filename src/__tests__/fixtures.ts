import type { NetworkSnapshot, ProbeResult } from '../types';

export const NOW = 2_000_000;

export function snapshot(
  overrides: Partial<NetworkSnapshot> = {}
): NetworkSnapshot {
  return {
    isConnected: true,
    isValidated: true,
    isCaptivePortal: false,
    transport: 'wifi',
    isVpn: false,
    isExpensive: false,
    isConstrained: false,
    isRoaming: false,
    downlinkKbps: null,
    uplinkKbps: null,
    signalStrength: null,
    cellularGeneration: null,
    supportsIPv4: true,
    supportsIPv6: true,
    supportsDNS: true,
    unsatisfiedReason: null,
    timestamp: NOW,
    ...overrides,
  };
}

export function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    rttMs: 40,
    downlinkKbps: 25_000,
    bytesReceived: 200_000,
    durationMs: 250,
    transport: 'wifi',
    downloadError: null,
    timestamp: NOW,
    ...overrides,
  };
}
