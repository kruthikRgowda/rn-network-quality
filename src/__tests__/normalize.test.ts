import type { NativeNetworkSnapshot } from '../NativeNetworkQuality';
import { normalizeSnapshot } from '../normalize';

function nativeSnapshot(
  overrides: Partial<NativeNetworkSnapshot> = {}
): NativeNetworkSnapshot {
  return {
    isConnected: true,
    isValidated: null,
    isCaptivePortal: null,
    transport: 'wifi',
    isVpn: null,
    isExpensive: false,
    isConstrained: false,
    isRoaming: null,
    downlinkKbps: null,
    uplinkKbps: null,
    signalStrength: null,
    cellularGeneration: null,
    supportsIPv4: null,
    supportsIPv6: null,
    supportsDNS: null,
    unsatisfiedReason: null,
    timestamp: 123,
    ...overrides,
  };
}

describe('normalizeSnapshot', () => {
  it('preserves every supported value and null', () => {
    const input = nativeSnapshot({
      transport: 'cellular',
      cellularGeneration: '5g',
      unsatisfiedReason: 'notAvailable',
      downlinkKbps: 1_234,
    });

    expect(normalizeSnapshot(input)).toEqual(input);
  });

  it('maps an unknown transport to unknown', () => {
    expect(
      normalizeSnapshot(nativeSnapshot({ transport: 'satellite' })).transport
    ).toBe('unknown');
  });

  it('maps unknown nullable enum strings to their safe fallbacks', () => {
    const result = normalizeSnapshot(
      nativeSnapshot({
        cellularGeneration: '6g',
        unsatisfiedReason: 'futureReason',
      })
    );

    expect(result.cellularGeneration).toBeNull();
    expect(result.unsatisfiedReason).toBe('unknown');
  });

  it.each([
    'wifi',
    'cellular',
    'ethernet',
    'bluetooth',
    'vpn',
    'other',
    'none',
    'unknown',
  ])('accepts the %s transport', (transport) => {
    expect(normalizeSnapshot(nativeSnapshot({ transport })).transport).toBe(
      transport
    );
  });

  it('preserves zero numeric values and does not mutate its input', () => {
    const input = nativeSnapshot({
      downlinkKbps: 0,
      uplinkKbps: 0,
      signalStrength: 0,
      timestamp: 0,
    });
    const original = { ...input };

    expect(normalizeSnapshot(input)).toMatchObject(original);
    expect(input).toEqual(original);
  });
});
