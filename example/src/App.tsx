import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import {
  configure,
  getConfig,
  getNetworkQuality,
  useNetworkProbe,
  useNetworkQuality,
  type NetworkQuality,
  type NetworkQualityState,
  type QualityThresholds,
} from 'rn-network-quality';

type ThresholdPreset = 'default' | 'strict' | 'lenient';

type LogEntry = {
  id: number;
  timestamp: number;
  changed: string[];
};

const THROTTLE_OPTIONS = [0, 500, 1_000, 3_000] as const;

const THRESHOLD_PRESETS: Record<ThresholdPreset, QualityThresholds> = {
  default: {
    excellent: { minDownlinkKbps: 20_000, maxRttMs: 50 },
    good: { minDownlinkKbps: 5_000, maxRttMs: 150 },
    moderate: { minDownlinkKbps: 1_000, maxRttMs: 400 },
  },
  strict: {
    excellent: { minDownlinkKbps: 40_000, maxRttMs: 35 },
    good: { minDownlinkKbps: 10_000, maxRttMs: 100 },
    moderate: { minDownlinkKbps: 2_500, maxRttMs: 300 },
  },
  lenient: {
    excellent: { minDownlinkKbps: 10_000, maxRttMs: 80 },
    good: { minDownlinkKbps: 2_500, maxRttMs: 220 },
    moderate: { minDownlinkKbps: 500, maxRttMs: 600 },
  },
};

const STATE_FIELDS: (keyof NetworkQualityState)[] = [
  'isConnected',
  'isValidated',
  'isCaptivePortal',
  'transport',
  'isVpn',
  'isExpensive',
  'isConstrained',
  'isRoaming',
  'downlinkKbps',
  'uplinkKbps',
  'signalStrength',
  'cellularGeneration',
  'supportsIPv4',
  'supportsIPv6',
  'supportsDNS',
  'unsatisfiedReason',
  'timestamp',
  'quality',
  'qualitySource',
  'effectiveDownlinkKbps',
  'effectiveRttMs',
  'lastProbe',
  'reasons',
];

const QUALITY_COLORS: Record<NetworkQuality, string> = {
  unknown: '#64748b',
  offline: '#475569',
  poor: '#dc2626',
  moderate: '#d97706',
  good: '#16a34a',
  excellent: '#0284c7',
};

const VIDEO_RECOMMENDATION: Record<NetworkQuality, string> = {
  excellent: '1080p',
  good: '720p',
  moderate: '480p',
  poor: '240p',
  offline: 'Paused',
  unknown: 'Auto',
};

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedFields(
  previous: NetworkQualityState | null,
  current: NetworkQualityState
): string[] {
  if (previous === null) return ['initial snapshot'];
  return STATE_FIELDS.filter(
    (field) =>
      field !== 'timestamp' && !valuesEqual(previous[field], current[field])
  );
}

function displayValue(value: unknown): string {
  if (value === null) return '— (not available on this platform)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join('\n');
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  if (typeof value === 'number')
    return Number.isInteger(value) ? `${value}` : value.toFixed(1);
  return String(value);
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

function formatBandwidth(value: number | null): string {
  if (value === null) return '—';
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} Mbps`;
  return `${Math.round(value)} kbps`;
}

function AppButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function SegmentedControl<T extends string | number>({
  values,
  selected,
  labelFor,
  onChange,
}: {
  values: readonly T[];
  selected: T;
  labelFor: (value: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.segmentRow}>
      {values.map((value) => {
        const active = value === selected;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={String(value)}
            onPress={() => onChange(value)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text
              style={[styles.segmentText, active && styles.segmentTextActive]}
            >
              {labelFor(value)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const maximum = Math.max(...values, 1);
  return (
    <View
      accessibilityLabel="Recent effective downlink sparkline"
      style={styles.sparkline}
    >
      {values.length === 0 ? (
        <Text style={styles.muted}>Waiting for bandwidth data…</Text>
      ) : (
        values.map((value, index) => (
          <View
            key={`${index}-${value}`}
            style={[
              styles.sparkBar,
              { height: Math.max(2, Math.round((value / maximum) * 72)) },
            ]}
          />
        ))
      )}
    </View>
  );
}

export default function App() {
  const systemScheme = useColorScheme();
  const state = useNetworkQuality();
  const {
    probe,
    isProbing,
    result: probeResult,
    error: probeError,
  } = useNetworkProbe();
  const initialConfig = useRef(getConfig());
  const previousState = useRef<NetworkQualityState | null>(null);
  const nextLogId = useRef(1);
  const [throttleMs, setThrottleMs] = useState(
    initialConfig.current.throttleMs
  );
  const [autoProbeEnabled, setAutoProbeEnabled] = useState(
    initialConfig.current.autoProbe.enabled
  );
  const [thresholdPreset, setThresholdPreset] =
    useState<ThresholdPreset>('default');
  const [bandwidthHistory, setBandwidthHistory] = useState<number[]>([]);
  const [eventLog, setEventLog] = useState<LogEntry[]>([]);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  const dark = systemScheme === 'dark';
  const quality = state?.quality ?? 'unknown';
  const recommendation = VIDEO_RECOMMENDATION[quality];

  useEffect(() => {
    if (state === null) return;
    const changed = changedFields(previousState.current, state);
    previousState.current = state;
    if (changed.length > 0) {
      setEventLog((current) =>
        [
          {
            id: nextLogId.current++,
            timestamp: Date.now(),
            changed,
          },
          ...current,
        ].slice(0, 50)
      );
    }
    if (state.effectiveDownlinkKbps !== null) {
      setBandwidthHistory((current) =>
        [...current, state.effectiveDownlinkKbps as number].slice(-60)
      );
    }
  }, [state]);

  const applyThrottle = useCallback(
    (value: (typeof THROTTLE_OPTIONS)[number]) => {
      configure({ throttleMs: value });
      setThrottleMs(value);
    },
    []
  );

  const applyAutoProbe = useCallback((enabled: boolean) => {
    configure({ autoProbe: { enabled } });
    setAutoProbeEnabled(enabled);
  }, []);

  const applyThresholdPreset = useCallback((preset: ThresholdPreset) => {
    configure({ thresholds: THRESHOLD_PRESETS[preset] });
    setThresholdPreset(preset);
  }, []);

  const requestPhoneState = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      {
        title: 'Show cellular generation',
        message:
          'The example can optionally read the cellular radio generation. The library itself never requests this permission.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      }
    );
    setSnapshotMessage(
      granted === PermissionsAndroid.RESULTS.GRANTED
        ? 'Phone-state permission granted. Refresh the snapshot on cellular.'
        : 'Phone-state permission was not granted.'
    );
  }, []);

  const requestSnapshot = useCallback(async () => {
    try {
      const next = await getNetworkQuality();
      setSnapshotMessage(
        `Snapshot at ${formatTime(next.timestamp)}: ${next.quality} over ${next.transport}`
      );
    } catch (error) {
      setSnapshotMessage(
        error instanceof Error ? error.message : String(error)
      );
    }
  }, []);

  const palette = useMemo(
    () => ({
      background: dark ? '#07111f' : '#eef4f8',
      card: dark ? '#111c2d' : '#ffffff',
      text: dark ? '#f8fafc' : '#0f172a',
      border: dark ? '#263449' : '#d9e2ec',
      muted: dark ? '#a8b3c4' : '#526172',
    }),
    [dark]
  );

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: palette.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={[styles.eyebrow, { color: palette.muted }]}>
            LIVE LINK SIGNALS
          </Text>
          <Text style={[styles.title, { color: palette.text }]}>
            Network Quality Lab
          </Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>
            Native connectivity signals plus an opt-in active probe.
          </Text>
        </View>

        <View
          style={[
            styles.qualityCard,
            { backgroundColor: QUALITY_COLORS[quality] },
          ]}
        >
          <Text style={styles.qualityLabel}>
            {state ? state.quality : 'Waiting…'}
          </Text>
          <Text style={styles.qualitySource}>
            {state
              ? `Source: ${state.qualitySource}`
              : 'Listening for the first native event'}
          </Text>
          <View style={styles.metricStrip}>
            <View>
              <Text style={styles.metricCaption}>Downlink</Text>
              <Text style={styles.metricValue}>
                {formatBandwidth(state?.effectiveDownlinkKbps ?? null)}
              </Text>
            </View>
            <View>
              <Text style={styles.metricCaption}>RTT</Text>
              <Text style={styles.metricValue}>
                {state?.effectiveRttMs == null
                  ? '—'
                  : `${state.effectiveRttMs.toFixed(0)} ms`}
              </Text>
            </View>
            <View>
              <Text style={styles.metricCaption}>Transport</Text>
              <Text style={styles.metricValue}>{state?.transport ?? '—'}</Text>
            </View>
          </View>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            Why this matters
          </Text>
          <Text
            style={[styles.recommendation, { color: QUALITY_COLORS[quality] }]}
          >
            Recommended video: {recommendation}
          </Text>
          <Text style={[styles.body, { color: palette.muted }]}>
            A plain online/offline flag would only say “
            {state === null
              ? 'waiting for native state'
              : state.isConnected
                ? 'online'
                : 'offline'}
            ”. This tier can choose a bitrate, defer uploads, or warn before a
            connection fails.
          </Text>
          {state?.reasons.map((reason) => (
            <Text key={reason} style={[styles.reason, { color: palette.text }]}>
              • {reason}
            </Text>
          ))}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <View style={styles.cardHeadingRow}>
            <View>
              <Text style={[styles.cardTitle, { color: palette.text }]}>
                Bandwidth history
              </Text>
              <Text style={[styles.caption, { color: palette.muted }]}>
                Last 60 usable samples
              </Text>
            </View>
            <Text style={[styles.caption, { color: palette.muted }]}>
              {formatBandwidth(bandwidthHistory.at(-1) ?? null)}
            </Text>
          </View>
          <Sparkline values={bandwidthHistory} />
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            Active probe
          </Text>
          <Text style={[styles.body, { color: palette.muted }]}>
            Measures median RTT and, when the response is large enough, download
            throughput.
          </Text>
          <AppButton
            disabled={isProbing}
            label={isProbing ? 'Probe running…' : 'Run probe'}
            onPress={() => probe().catch(() => undefined)}
          />
          {isProbing ? <ActivityIndicator style={styles.spinner} /> : null}
          {probeResult ? (
            <View style={styles.probeGrid}>
              <Text style={[styles.body, { color: palette.text }]}>
                RTT:{' '}
                {probeResult.rttMs == null
                  ? '—'
                  : `${probeResult.rttMs.toFixed(1)} ms`}
              </Text>
              <Text style={[styles.body, { color: palette.text }]}>
                Downlink: {formatBandwidth(probeResult.downlinkKbps)}
              </Text>
              <Text style={[styles.body, { color: palette.text }]}>
                Bytes: {probeResult.bytesReceived.toLocaleString()}
              </Text>
              <Text style={[styles.body, { color: palette.text }]}>
                Duration: {probeResult.durationMs.toFixed(0)} ms
              </Text>
              <Text style={[styles.body, { color: palette.text }]}>
                Download error: {probeResult.downloadError ?? 'None'}
              </Text>
            </View>
          ) : null}
          {probeError ? (
            <Text style={styles.errorText}>
              {probeError.code}: {probeError.message}
            </Text>
          ) : null}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            Settings
          </Text>
          <Text style={[styles.settingLabel, { color: palette.text }]}>
            Native throttle
          </Text>
          <SegmentedControl
            labelFor={(value) => `${value} ms`}
            onChange={applyThrottle}
            selected={throttleMs as (typeof THROTTLE_OPTIONS)[number]}
            values={THROTTLE_OPTIONS}
          />
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={[styles.settingLabel, { color: palette.text }]}>
                Auto-probe
              </Text>
              <Text style={[styles.caption, { color: palette.muted }]}>
                Pauses in background and avoids costly links.
              </Text>
            </View>
            <Switch value={autoProbeEnabled} onValueChange={applyAutoProbe} />
          </View>
          <Text style={[styles.settingLabel, { color: palette.text }]}>
            Threshold preset
          </Text>
          <SegmentedControl
            labelFor={(value) => value}
            onChange={applyThresholdPreset}
            selected={thresholdPreset}
            values={['default', 'strict', 'lenient'] as const}
          />
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            Snapshot actions
          </Text>
          <AppButton label="Get snapshot now" onPress={requestSnapshot} />
          {Platform.OS === 'android' ? (
            <AppButton
              label="Grant phone state (optional)"
              onPress={requestPhoneState}
            />
          ) : null}
          {snapshotMessage ? (
            <Text style={[styles.body, { color: palette.muted }]}>
              {snapshotMessage}
            </Text>
          ) : null}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            Live state
          </Text>
          {state === null ? (
            <Text style={[styles.body, { color: palette.muted }]}>
              Waiting for native state…
            </Text>
          ) : (
            STATE_FIELDS.map((field) => (
              <View
                key={field}
                style={[styles.stateRow, { borderBottomColor: palette.border }]}
              >
                <Text style={[styles.stateKey, { color: palette.muted }]}>
                  {field}
                </Text>
                <Text
                  selectable
                  style={[styles.stateValue, { color: palette.text }]}
                >
                  {displayValue(state[field])}
                </Text>
              </View>
            ))
          )}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: palette.card, borderColor: palette.border },
          ]}
        >
          <View style={styles.cardHeadingRow}>
            <View>
              <Text style={[styles.cardTitle, { color: palette.text }]}>
                Event log
              </Text>
              <Text style={[styles.caption, { color: palette.muted }]}>
                Newest first · up to 50 events
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setEventLog([])}
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>
          {eventLog.length === 0 ? (
            <Text style={[styles.body, { color: palette.muted }]}>
              No events yet.
            </Text>
          ) : (
            eventLog.map((entry) => (
              <View
                key={entry.id}
                style={[styles.logRow, { borderBottomColor: palette.border }]}
              >
                <Text style={[styles.logTime, { color: palette.muted }]}>
                  {formatTime(entry.timestamp)}
                </Text>
                <Text style={[styles.logChanges, { color: palette.text }]}>
                  {entry.changed.join(', ')}
                </Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  content: { padding: 18, paddingBottom: 48, gap: 14 },
  header: { paddingVertical: 12 },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.8 },
  title: { fontSize: 32, fontWeight: '800', letterSpacing: -1, marginTop: 4 },
  subtitle: { fontSize: 15, lineHeight: 22, marginTop: 5 },
  qualityCard: { borderRadius: 24, padding: 22 },
  qualityLabel: {
    color: '#ffffff',
    fontSize: 40,
    fontWeight: '900',
    textTransform: 'capitalize',
  },
  qualitySource: { color: '#ffffffcc', fontSize: 14, marginTop: 2 },
  metricStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    gap: 12,
  },
  metricCaption: {
    color: '#ffffffb8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 3,
    textTransform: 'capitalize',
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    padding: 17,
  },
  cardTitle: { fontSize: 19, fontWeight: '800', marginBottom: 8 },
  cardHeadingRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  recommendation: { fontSize: 22, fontWeight: '900', marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 21, marginBottom: 6 },
  reason: { fontSize: 13, lineHeight: 20 },
  caption: { fontSize: 12, lineHeight: 17 },
  muted: { color: '#64748b', fontSize: 13 },
  sparkline: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    height: 84,
    gap: 2,
    paddingTop: 10,
  },
  sparkBar: {
    backgroundColor: '#0ea5e9',
    borderRadius: 2,
    flex: 1,
    minWidth: 2,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#0f766e',
    borderRadius: 12,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  spinner: { marginTop: 12 },
  probeGrid: { gap: 2, marginTop: 12 },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 7,
  },
  segmentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  segment: {
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  segmentActive: { backgroundColor: '#0f766e' },
  segmentText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  segmentTextActive: { color: '#ffffff' },
  switchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 12,
  },
  switchCopy: { flex: 1, paddingRight: 12 },
  stateRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  stateKey: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  stateValue: { fontSize: 13, lineHeight: 19 },
  clearText: { color: '#0ea5e9', fontSize: 13, fontWeight: '800' },
  logRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 9,
  },
  logTime: { fontSize: 11, width: 78 },
  logChanges: { flex: 1, fontSize: 12, lineHeight: 17 },
});
