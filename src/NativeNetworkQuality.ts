import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

export type NativeNetworkSnapshot = {
  isConnected: boolean;
  isValidated: boolean | null;
  isCaptivePortal: boolean | null;
  transport: string;
  isVpn: boolean | null;
  isExpensive: boolean;
  isConstrained: boolean;
  isRoaming: boolean | null;
  downlinkKbps: number | null;
  uplinkKbps: number | null;
  signalStrength: number | null;
  cellularGeneration: string | null;
  supportsIPv4: boolean | null;
  supportsIPv6: boolean | null;
  supportsDNS: boolean | null;
  unsatisfiedReason: string | null;
  timestamp: number;
};

export type NativeMonitorOptions = {
  throttleMs: number;
  bandwidthChangeThresholdPct: number;
};

export type NativeProbeOptions = {
  latencyUrl: string;
  downloadUrl: string | null;
  latencySamples: number;
  timeoutMs: number;
};

export type NativeProbeResult = {
  rttMs: number | null;
  downlinkKbps: number | null;
  bytesReceived: number;
  durationMs: number;
  downloadError: string | null;
  timestamp: number;
};

export interface Spec extends TurboModule {
  getCurrentState(): Promise<NativeNetworkSnapshot>;
  startMonitoring(options: NativeMonitorOptions): void;
  stopMonitoring(): void;
  probe(options: NativeProbeOptions): Promise<NativeProbeResult>;
  readonly onNetworkStateChange: CodegenTypes.EventEmitter<NativeNetworkSnapshot>;
}

export default TurboModuleRegistry.get<Spec>('NetworkQuality');
