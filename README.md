# rn-network-quality

[![npm version](https://img.shields.io/npm/v/rn-network-quality.svg)](https://www.npmjs.com/package/rn-network-quality)
[![CI](https://github.com/kruthikRgowda/rn-network-quality-/actions/workflows/ci.yml/badge.svg)](https://github.com/kruthikRgowda/rn-network-quality-/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![React Native New Architecture](https://img.shields.io/badge/React%20Native-New%20Architecture-61dafb.svg)](https://reactnative.dev/architecture/landing-page)

Live network quality signals for React Native—bandwidth, link quality, and
connectivity through a New Architecture TurboModule.

## Why

An online/offline flag only says that a route may exist. It cannot tell an app
whether that route is validated, behind a captive portal, constrained by a data
saving mode, or too slow for the experience it is about to start.

`rn-network-quality` combines event-driven operating-system signals with an
optional active probe and a deterministic TypeScript classifier. Your app gets
one actionable tier:

```text
offline | poor | moderate | good | excellent | unknown
```

Use it to choose a video rendition, reduce image quality, postpone a large
upload, or explain why an operation may be slow. The raw measurements remain
available when your product needs a different policy.

## Features

- Live default-network updates from Android `ConnectivityManager` and iOS
  `NWPathMonitor`
- Transport, validation, captive-portal, metered/expensive, constrained,
  roaming, IP-family, DNS, signal, and cellular-generation signals
- Android OS bandwidth estimates and an opt-in cross-platform latency and
  throughput probe
- Pure, configurable quality classification with human-readable reasons
- Ref-counted monitoring, native de-duplication, and trailing-edge throttling
- Hooks, imperative functions, typed errors, and a consumer Jest mock
- No third-party runtime dependencies, polling, analytics, or telemetry
- New Architecture TurboModule implementations in Kotlin and Swift/Objective-C++

## Requirements and platform support

| Requirement         | Support                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| React Native        | `>=0.80.0`; React Native 0.87.1 is used by this repository             |
| Architecture        | New Architecture only                                                  |
| Android             | API 24 or newer                                                        |
| iOS                 | iOS 15.1 or newer, matching React Native 0.87.1                        |
| Expo                | Development builds and prebuild projects are supported; Expo Go is not |
| Web, Windows, macOS | Not supported                                                          |

React Native 0.80 is the peer-dependency floor because its Codegen parser
supports the `CodegenTypes.EventEmitter` property syntax used by this module's
TurboModule spec. The package has no old-architecture fallback.

## Installation

With Yarn:

```sh
yarn add rn-network-quality
```

Or with npm:

```sh
npm install rn-network-quality
```

Install iOS pods from your application's iOS directory, then rebuild the app:

```sh
cd ios
pod install
```

Android autolinking requires no extra setup. This is native code, so adding the
package always requires a new native build.

## Quick start

`useNetworkQuality()` starts monitoring when the component subscribes and stops
it after the final subscriber unmounts. It returns `null` until the first native
snapshot arrives.

```tsx
import { Text, View } from 'react-native';
import { useNetworkQuality } from 'rn-network-quality';

export function ConnectionSummary() {
  const network = useNetworkQuality();

  if (network === null) {
    return <Text>Checking connection…</Text>;
  }

  return (
    <View>
      <Text>Quality: {network.quality}</Text>
      <Text>Transport: {network.transport}</Text>
      <Text>Source: {network.qualitySource}</Text>
    </View>
  );
}
```

Here is a small adaptive-video policy. `unknown` is deliberately unranked, so
it does not satisfy any minimum tier.

```ts
import { isQualityAtLeast, type NetworkQuality } from 'rn-network-quality';

export function videoHeightFor(quality: NetworkQuality): number | null {
  if (isQualityAtLeast(quality, 'excellent')) return 1080;
  if (isQualityAtLeast(quality, 'good')) return 720;
  if (isQualityAtLeast(quality, 'moderate')) return 480;
  if (quality === 'poor') return 240;
  return null;
}
```

## API reference

All runtime functions and types below are exported from `rn-network-quality`.

### `isSupported()`

```ts
function isSupported(): boolean;
```

Returns whether the `NetworkQuality` TurboModule is linked on this platform. It
never throws and is useful before rendering a feature on an optional platform.

```ts
import { isSupported } from 'rn-network-quality';

const canShowNetworkDiagnostics = isSupported();
```

### `configure(config)`

```ts
function configure(config: DeepPartial<NetworkQualityConfig>): void;
```

Deep-merges the supplied values with the current configuration, reclassifies
the cached state, and updates active native monitoring. `autoProbe.intervalMs`
is clamped to at least 15 seconds. Negative durations, invalid numeric values,
and non-monotonic thresholds throw `TypeError`. An unlinked native module throws
`NetworkQualityError` with `E_UNSUPPORTED`.

```ts
import { configure } from 'rn-network-quality';

configure({
  throttleMs: 500,
  thresholds: {
    good: { minDownlinkKbps: 8_000, maxRttMs: 120 },
  },
  autoProbe: {
    enabled: true,
    intervalMs: 120_000,
    allowOnExpensive: false,
    allowOnConstrained: false,
  },
});
```

### `getConfig()`

```ts
function getConfig(): NetworkQualityConfig;
```

Returns the current fully merged configuration. It throws `E_UNSUPPORTED` if
the native module is unavailable.

```ts
import { getConfig } from 'rn-network-quality';

const probeTimeout = getConfig().probe.timeoutMs;
```

### `getNetworkQuality()`

```ts
function getNetworkQuality(): Promise<NetworkQualityState>;
```

Reads and classifies the current state whether continuous monitoring is active
or not. If the native module is not linked, it throws `E_UNSUPPORTED` before
returning a promise. Platform failures that prevent a snapshot reject the
promise and are passed through by the native implementation.

```ts
import { getNetworkQuality } from 'rn-network-quality';

const state = await getNetworkQuality();
console.log(state.quality, state.reasons);
```

### `addNetworkQualityListener(listener)`

```ts
function addNetworkQualityListener(
  listener: (state: NetworkQualityState) => void
): { remove(): void };
```

Adds a live-state listener. The first listener starts native monitoring and the
last removal stops it. A cached state is sent to a new listener in a microtask.
Calling `remove()` more than once is safe. Registration throws `E_UNSUPPORTED`
if the module is not linked. Because native monitoring owns active-probe
resources, removing the last listener also cancels an in-flight probe; its
promise rejects with `E_PROBE_FAILED`.

```ts
import { addNetworkQualityListener } from 'rn-network-quality';

const subscription = addNetworkQualityListener((state) => {
  console.log(state.quality, state.effectiveDownlinkKbps);
});

subscription.remove();
```

### `probeNetwork(options?)`

```ts
function probeNetwork(options?: Partial<ProbeConfig>): Promise<ProbeResult>;
```

Runs one opt-in active probe. Options override the configured probe defaults.
Concurrent calls share the same in-flight promise. The result becomes
`lastProbe` and influences classification while it is fresh and its transport
still matches. When calls overlap, the first call's options apply to the shared
probe.

Invalid option values throw a synchronous `TypeError`. An unavailable native
module similarly throws `E_UNSUPPORTED` before returning a promise. Once native
work begins, the promise can reject with `E_INVALID_URL`, `E_OFFLINE`,
`E_PROBE_TIMEOUT`, or `E_PROBE_FAILED`. A failed throughput phase does not
reject the probe when latency succeeded; inspect `downloadError` instead.

```ts
import { probeNetwork } from 'rn-network-quality';

const result = await probeNetwork({
  latencyUrl: 'https://network.example.com/204',
  downloadUrl: 'https://network.example.com/probe-1500kb.bin',
  timeoutMs: 6_000,
});

console.log(result.rttMs, result.downlinkKbps);
```

### `getLastProbeResult()`

```ts
function getLastProbeResult(): ProbeResult | null;
```

Returns the most recent successful probe, or `null` before one succeeds. This
does not start network traffic. It throws `E_UNSUPPORTED` if the native module
is unavailable.

```ts
import { getLastProbeResult } from 'rn-network-quality';

const lastMeasuredAt = getLastProbeResult()?.timestamp ?? null;
```

### `classifyNetworkQuality(snapshot, probe, config?, now?)`

```ts
function classifyNetworkQuality(
  snapshot: NetworkSnapshot,
  probe: ProbeResult | null,
  config?: Pick<NetworkQualityConfig, 'thresholds' | 'probe'>,
  now?: number
): Pick<
  NetworkQualityState,
  | 'quality'
  | 'qualitySource'
  | 'effectiveDownlinkKbps'
  | 'effectiveRttMs'
  | 'reasons'
>;
```

Purely classifies input values without native access or side effects. `now`
defaults to `Date.now()` and can be injected for deterministic tests. It works
on unsupported platforms and does not throw for a valid typed input.

```ts
import {
  classifyNetworkQuality,
  type NetworkSnapshot,
} from 'rn-network-quality';

const snapshot: NetworkSnapshot = {
  isConnected: true,
  isValidated: true,
  isCaptivePortal: false,
  transport: 'wifi',
  isVpn: false,
  isExpensive: false,
  isConstrained: false,
  isRoaming: false,
  downlinkKbps: 12_000,
  uplinkKbps: 2_000,
  signalStrength: null,
  cellularGeneration: null,
  supportsIPv4: true,
  supportsIPv6: true,
  supportsDNS: true,
  unsatisfiedReason: null,
  timestamp: 1_795_027_200_000,
};

const classification = classifyNetworkQuality(snapshot, null);
```

### `isQualityAtLeast(quality, minimum)`

```ts
function isQualityAtLeast(
  quality: NetworkQuality,
  minimum: NetworkQuality
): boolean;
```

Compares ranked tiers from `offline` through `excellent`. Because `unknown` has
no rank, the function returns `false` when either argument is `unknown`. It is
pure and works without the native module.

```ts
import { isQualityAtLeast } from 'rn-network-quality';

const canAutoplayHd = isQualityAtLeast('good', 'moderate'); // true
```

### `useNetworkQuality()`

```ts
function useNetworkQuality(): NetworkQualityState | null;
```

A `useSyncExternalStore`-based hook for live state. It returns `null` before the
first event and subscribes/unsubscribes with the component lifecycle. Linking
problems surface as `E_UNSUPPORTED` during render.

```tsx
import { Text } from 'react-native';
import { useNetworkQuality } from 'rn-network-quality';

export function TransportLabel() {
  const state = useNetworkQuality();
  return <Text>{state?.transport ?? 'detecting'}</Text>;
}
```

### `useNetworkProbe()`

```ts
function useNetworkProbe(): {
  probe: (options?: Partial<ProbeConfig>) => Promise<ProbeResult>;
  isProbing: boolean;
  result: ProbeResult | null;
  error: NetworkQualityError | null;
};
```

Tracks one component's probe status, last result, and typed error. Results that
arrive after unmount are ignored. The returned `probe` preserves known
`NetworkQualityError` codes; unexpected failures, including invalid options,
reject with `E_PROBE_FAILED` and populate `error`. If the native module is
unavailable, the hook throws `E_UNSUPPORTED` during render.

```tsx
import { Button, Text } from 'react-native';
import { useNetworkProbe } from 'rn-network-quality';

export function ProbeButton() {
  const { probe, isProbing, result, error } = useNetworkProbe();

  return (
    <>
      <Button
        title={isProbing ? 'Measuring…' : 'Measure network'}
        disabled={isProbing}
        onPress={() => void probe().catch(() => undefined)}
      />
      <Text>{result?.rttMs ?? '—'} ms</Text>
      {error ? (
        <Text>
          {error.code}: {error.message}
        </Text>
      ) : null}
    </>
  );
}
```

### `NetworkQualityError`

```ts
class NetworkQualityError extends Error {
  readonly code: NetworkQualityErrorCode;
  readonly cause?: unknown;
  constructor(
    code: NetworkQualityErrorCode,
    message: string,
    options?: { cause?: unknown }
  );
}
```

`NetworkQualityError` exposes a stable `code`. The exported codes are
`E_UNSUPPORTED`, `E_OFFLINE`, `E_INVALID_URL`, `E_PROBE_TIMEOUT`,
`E_PROBE_FAILED`, and `E_PROBE_SKIPPED`. The final code is reserved for caller
or policy layers; the package's built-in scheduled auto-probe skips are silent.

| Code              | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `E_UNSUPPORTED`   | The TurboModule is absent, unlinked, or unavailable on this platform    |
| `E_OFFLINE`       | A probe was requested without a connected default network               |
| `E_INVALID_URL`   | A probe endpoint is malformed or is not HTTP(S)                         |
| `E_PROBE_TIMEOUT` | Latency did not finish before the whole-probe deadline                  |
| `E_PROBE_FAILED`  | Latency, cancellation, cookie isolation, or probe infrastructure failed |
| `E_PROBE_SKIPPED` | Reserved for a JavaScript policy that elects not to probe               |

```ts
import { NetworkQualityError, probeNetwork } from 'rn-network-quality';

try {
  await probeNetwork();
} catch (error) {
  if (error instanceof NetworkQualityError && error.code === 'E_OFFLINE') {
    console.log('Connect before measuring');
  }
}
```

### Constants

```ts
const DEFAULT_CONFIG: NetworkQualityConfig;
const QUALITY_ORDER: NetworkQuality[];
```

`DEFAULT_CONFIG` contains the documented defaults. `QUALITY_ORDER` is
`['offline', 'poor', 'moderate', 'good', 'excellent']`; `unknown` is omitted
because it is not ranked.

```ts
import { DEFAULT_CONFIG, QUALITY_ORDER } from 'rn-network-quality';

console.log(DEFAULT_CONFIG.throttleMs, QUALITY_ORDER.indexOf('good'));
```

### Exported types

| Type                      | Purpose                                     | Example value                              |
| ------------------------- | ------------------------------------------- | ------------------------------------------ |
| `Transport`               | Default route kind                          | `'wifi'`                                   |
| `CellularGeneration`      | Coarse radio generation                     | `'5g'`                                     |
| `NetworkQuality`          | Classified tier                             | `'good'`                                   |
| `QualitySource`           | Evidence used by the classifier             | `'probe'`                                  |
| `UnsatisfiedReason`       | iOS unsatisfied-path reason                 | `'wifiDenied'`                             |
| `NetworkSnapshot`         | Raw normalized OS signals                   | `{ ...snapshot }`                          |
| `ProbeResult`             | Active-probe measurements                   | `{ rttMs: 42, ... }`                       |
| `NetworkQualityState`     | Snapshot plus classification                | `{ quality: 'good', ... }`                 |
| `TierThreshold`           | One tier's bandwidth and RTT bounds         | `{ minDownlinkKbps: 5000, maxRttMs: 150 }` |
| `QualityThresholds`       | Excellent, good, and moderate bounds        | `{ excellent, good, moderate }`            |
| `ProbeConfig`             | Probe endpoints, samples, timeout, and TTL  | `DEFAULT_CONFIG.probe`                     |
| `AutoProbeConfig`         | Automatic-probe policy                      | `DEFAULT_CONFIG.autoProbe`                 |
| `NetworkQualityConfig`    | Complete library configuration              | `DEFAULT_CONFIG`                           |
| `NetworkQualityErrorCode` | Stable error-code union                     | `'E_OFFLINE'`                              |
| `DeepPartial<T>`          | Recursive optional form used by `configure` | `{ autoProbe: { enabled: true } }`         |

Import types with `import type`, for example:

```ts
import type { NetworkQualityState, ProbeConfig } from 'rn-network-quality';
```

### Configuration reference

`configure()` accepts a recursive partial value, so changing one nested field
does not reset its siblings. `getConfig()` returns a defensive copy.

| Field                                  | Default                                             | Meaning                                                              |
| -------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------- |
| `throttleMs`                           | `1000`                                              | Minimum interval for minor native numeric updates                    |
| `bandwidthChangeThresholdPct`          | `10`                                                | Percentage movement required for bandwidth or signal updates         |
| `thresholds.excellent.minDownlinkKbps` | `20000`                                             | Excellent minimum downstream rate                                    |
| `thresholds.excellent.maxRttMs`        | `50`                                                | Excellent maximum round-trip time                                    |
| `thresholds.good.minDownlinkKbps`      | `5000`                                              | Good minimum downstream rate                                         |
| `thresholds.good.maxRttMs`             | `150`                                               | Good maximum round-trip time                                         |
| `thresholds.moderate.minDownlinkKbps`  | `1000`                                              | Moderate minimum downstream rate                                     |
| `thresholds.moderate.maxRttMs`         | `400`                                               | Moderate maximum round-trip time                                     |
| `probe.latencyUrl`                     | `https://www.gstatic.com/generate_204`              | Latency endpoint                                                     |
| `probe.downloadUrl`                    | `https://speed.cloudflare.com/__down?bytes=1500000` | Throughput payload endpoint; `null` disables this phase              |
| `probe.latencySamples`                 | `3`                                                 | Retained requests after one warm-up                                  |
| `probe.timeoutMs`                      | `8000`                                              | Whole-probe time budget                                              |
| `probe.resultTtlMs`                    | `60000`                                             | How long same-transport probe data influences quality                |
| `autoProbe.enabled`                    | `false`                                             | Whether scheduled probing is active                                  |
| `autoProbe.intervalMs`                 | `60000`                                             | Scheduled interval, clamped to at least `15000`                      |
| `autoProbe.onTransportChange`          | `true`                                              | Schedule a debounced probe after a transport change                  |
| `autoProbe.allowOnExpensive`           | `false`                                             | Permit automatic traffic on an OS-designated expensive network       |
| `autoProbe.allowOnConstrained`         | `false`                                             | Permit automatic traffic while Data Saver or Low Data Mode is active |

Durations and thresholds must be finite and non-negative;
`probe.timeoutMs` must be positive and no greater than `2_147_483_647`;
`probe.latencySamples` must be an integer from 1 through 100; probe URLs must be
non-empty strings; and automatic-probe flags must be booleans. URL scheme and
parseability are checked when a probe is started.

## State reference

`null` means the signal is not available on the current platform, OS version,
network, or permission state. It is different from `false` and from a zero
measurement.

| Field                   | Type                         | Meaning                                                                           |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------------------- |
| `isConnected`           | `boolean`                    | The default path can carry internet traffic                                       |
| `isValidated`           | `boolean \| null`            | The OS validated access beyond the local link                                     |
| `isCaptivePortal`       | `boolean \| null`            | The OS detected a sign-in/captive portal                                          |
| `transport`             | `Transport`                  | Default route: Wi-Fi, cellular, Ethernet, Bluetooth, VPN, other, none, or unknown |
| `isVpn`                 | `boolean \| null`            | Whether a VPN transport can be identified                                         |
| `isExpensive`           | `boolean`                    | The OS considers data usage potentially costly                                    |
| `isConstrained`         | `boolean`                    | Data Saver or Low Data Mode is active                                             |
| `isRoaming`             | `boolean \| null`            | The cellular network is roaming                                                   |
| `downlinkKbps`          | `number \| null`             | OS downstream estimate in kilobits per second                                     |
| `uplinkKbps`            | `number \| null`             | OS upstream estimate in kilobits per second                                       |
| `signalStrength`        | `number \| null`             | Bearer-dependent Android signal value; units are not normalized across transports |
| `cellularGeneration`    | `CellularGeneration \| null` | Coarse 2G/3G/4G/5G radio generation                                               |
| `supportsIPv4`          | `boolean \| null`            | The route supports IPv4                                                           |
| `supportsIPv6`          | `boolean \| null`            | The route supports IPv6                                                           |
| `supportsDNS`           | `boolean \| null`            | DNS service is available on the route                                             |
| `unsatisfiedReason`     | `UnsatisfiedReason \| null`  | Why iOS reports an unsatisfied path                                               |
| `timestamp`             | `number`                     | Snapshot time in Unix-epoch milliseconds                                          |
| `quality`               | `NetworkQuality`             | Derived quality tier                                                              |
| `qualitySource`         | `QualitySource`              | Probe, OS estimate, heuristic, or none                                            |
| `effectiveDownlinkKbps` | `number \| null`             | Downlink value actually used for classification                                   |
| `effectiveRttMs`        | `number \| null`             | RTT value actually used for classification                                        |
| `lastProbe`             | `ProbeResult \| null`        | Most recent successful active probe                                               |
| `reasons`               | `string[]`                   | Human-readable classifier decisions                                               |

`ProbeResult` has its own measurement metadata:

| Field           | Type             | Meaning                                                           |
| --------------- | ---------------- | ----------------------------------------------------------------- |
| `rttMs`         | `number \| null` | Median retained latency in milliseconds                           |
| `downlinkKbps`  | `number \| null` | Measured downstream throughput in kilobits per second             |
| `bytesReceived` | `number`         | Throughput response bytes actually consumed                       |
| `durationMs`    | `number`         | Total probe duration in milliseconds                              |
| `transport`     | `Transport`      | Transport captured when the JS layer started the probe            |
| `downloadError` | `string \| null` | Non-fatal throughput-phase error after a successful latency phase |
| `timestamp`     | `number`         | Completion time in Unix-epoch milliseconds                        |

### Platform availability and mapping

| Field                           | Android                                                                                        | iOS                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `isConnected`                   | Default network exists and has `NET_CAPABILITY_INTERNET`                                       | `NWPath.status == .satisfied`                                           |
| `isValidated`                   | `NET_CAPABILITY_VALIDATED`                                                                     | Always `null`; no equivalent public API                                 |
| `isCaptivePortal`               | `NET_CAPABILITY_CAPTIVE_PORTAL`                                                                | Always `null`; no equivalent public API                                 |
| `transport`                     | Wi-Fi, cellular, Ethernet/USB, Bluetooth, VPN-only, or other; `none` without a default network | Wi-Fi, cellular, wired Ethernet, or other; `none` when unsatisfied      |
| `isVpn`                         | `TRANSPORT_VPN` is present, including VPN over another transport                               | Always `null`; the implementation does not guess from `utun` interfaces |
| `isExpensive`                   | Inverse of `NOT_METERED`; temporarily-not-metered is respected on API 30+                      | `NWPath.isExpensive`                                                    |
| `isConstrained`                 | Data Saver enabled                                                                             | `NWPath.isConstrained` (Low Data Mode)                                  |
| `isRoaming`                     | Inverse of `NOT_ROAMING` on API 28+; otherwise `null`                                          | Always `null`                                                           |
| `downlinkKbps`                  | `linkDownstreamBandwidthKbps`, or `null` when non-positive                                     | Always `null` from the OS; a probe can populate `effectiveDownlinkKbps` |
| `uplinkKbps`                    | `linkUpstreamBandwidthKbps`, or `null` when non-positive                                       | Always `null`                                                           |
| `signalStrength`                | Available on API 29+ when specified                                                            | Always `null`                                                           |
| `cellularGeneration`            | Available on cellular only when the host app has `READ_PHONE_STATE`                            | Available on cellular devices; `null` in the simulator                  |
| `supportsIPv4` / `supportsIPv6` | Derived from link-address families without exposing addresses                                  | `NWPath.supportsIPv4` / `supportsIPv6`                                  |
| `supportsDNS`                   | Whether DNS servers are present, without exposing their addresses                              | `NWPath.supportsDNS`                                                    |
| `unsatisfiedReason`             | Always `null`                                                                                  | Mapped from `NWPath.unsatisfiedReason` when the path is unsatisfied     |
| `timestamp`                     | `System.currentTimeMillis()`                                                                   | Unix time from `Date`                                                   |

Android evaluates transport in this order: Wi-Fi, cellular, Ethernet (including
USB on API 31+), Bluetooth, VPN when it is the only recognized transport, then
other. A VPN over Wi-Fi therefore reports `transport: 'wifi'` and `isVpn: true`.
iOS evaluates Wi-Fi, cellular, wired Ethernet, then other/loopback; it does not
infer VPN state from interface names.

Android maps GPRS, EDGE, CDMA, 1xRTT, IDEN, and GSM to `2g`; UMTS, EVDO variants,
HSDPA, HSUPA, HSPA, EHRPD, HSPAP, and TD-SCDMA to `3g`; LTE and IWLAN to `4g`;
and NR to `5g`. iOS maps GPRS, Edge, and CDMA1x to `2g`; WCDMA, HSDPA, HSUPA,
CDMA EVDO variants, and eHRPD to `3g`; LTE to `4g`; and NR/NRNSA to `5g`.
Unknown radio technologies remain `null`.

When an iOS path is unsatisfied, `unsatisfiedReason` can be `notAvailable`,
`cellularDenied`, `wifiDenied`, `localNetworkDenied`, `vpnInactive`, or
`unknown`. It is `null` for a satisfied path.

Android bandwidth figures are OS/carrier estimates, not speed-test results.
Wi-Fi estimates are commonly derived from link speed and can be optimistic.
iOS exposes no public bandwidth estimate, so run an active probe when a measured
value is important.

Android 5G non-standalone connections often report LTE and therefore appear as
`4g`. Signal-strength units are bearer-dependent and should be displayed as a
diagnostic value rather than compared across transport types.

## How quality is computed

Classification is deterministic and follows this order:

1. A disconnected snapshot is `offline` with source `none`.
2. A captive portal or explicitly unvalidated network is `poor`.
3. A probe is fresh only while it is within `resultTtlMs` and was measured on
   the current transport. A stale probe is ignored and the reason is recorded.
4. Fresh probe downlink takes priority over Android's OS estimate. Probe RTT is
   used when present.
5. Each available metric is tiered independently. When bandwidth and RTT
   disagree, the worse tier wins.
6. If no measurements exist, 4G/5G maps to `good`, 3G to `moderate`, and 2G to
   `poor`, with source `heuristic`.
7. If no measurement or cellular heuristic is available, quality is `unknown`.

When a fresh probe has no usable downlink value, Android's OS downlink estimate
is used as a fallback while the fresh RTT is still considered. `qualitySource`
is `probe` when either probe metric contributes, `os-estimate` when only the OS
downlink contributes, `heuristic` for cellular-generation fallback, and `none`
otherwise. `reasons` records decisions such as
`downlink 12000 kbps → good`, `rtt 180 ms → moderate`, and
`probe stale (transport changed)`.

`isExpensive` and `isConstrained` do not lower the tier. They describe user and
OS policy, so apps should respect them independently—for example, by deferring
a background upload even when measured quality is excellent.

Default thresholds are inclusive:

| Tier      | Minimum downlink |  Maximum RTT |
| --------- | ---------------: | -----------: |
| Excellent |      20,000 kbps |        50 ms |
| Good      |       5,000 kbps |       150 ms |
| Moderate  |       1,000 kbps |       400 ms |
| Poor      | Below 1,000 kbps | Above 400 ms |

Customize the thresholds with `configure()`. Bounds must remain monotonic:
excellent requires at least as much bandwidth and no more latency than good,
and good must be at least as strict as moderate.

## Active probing

Probing is opt-in. Calling `probeNetwork()` performs:

1. One warm-up request followed by three retained latency requests by default.
   The reported RTT is the median of retained samples.
2. One optional download capped at 5 MB. Measurements smaller than 32 KB leave
   `downlinkKbps` as `null`. Android also rejects downloads shorter than 50 ms;
   iOS accepts any positive measurable body duration so fast connections still
   produce a throughput value.
3. A whole-operation timeout, eight seconds by default.

Requests use random `_nq` cache-busting query values, `Cache-Control: no-cache`,
and isolated native sessions/connections without the host app's cookies or
cache. Latency failure rejects the operation. Download failure preserves the
latency result and sets `downloadError`.

Android's `HttpURLConnection` exposes only a process-wide `CookieHandler`. To
avoid reading or racing the host app's cookie store, Android fails the probe
with `E_PROBE_FAILED` when such a handler is installed; it never replaces or
mutates that handler.

### Default hosts and data use

The default latency endpoint is
`https://www.gstatic.com/generate_204`. The default throughput endpoint is
`https://speed.cloudflare.com/__down?bytes=1500000`. A default probe downloads
about 1.5 MB plus four small latency responses and protocol overhead. Endpoint
operators can observe ordinary request metadata such as source IP and headers;
the library adds no user identifier or telemetry.

For full control, self-host an HTTP(S) endpoint that returns an empty `204`
response and a static download of known size, then configure both URLs:

```ts
import { configure } from 'rn-network-quality';

configure({
  probe: {
    latencyUrl: 'https://network.example.com/204',
    downloadUrl: 'https://network.example.com/probe-1500kb.bin',
  },
});
```

Set `downloadUrl: null` to run latency only and avoid the throughput payload.
Only parseable `http` and `https` URLs are accepted.

### Automatic probes

Automatic probing is disabled by default. When explicitly enabled, it runs only
while at least one listener exists and the app is active. The interval is
clamped to 15 seconds or longer. A transport change can schedule a probe after a
two-second debounce. Offline runs are skipped, as are expensive or constrained
connections unless their corresponding allow flags are enabled. Moving to the
background pauses the interval; returning to the foreground resumes it.

## Permissions and privacy

The library declares only Android's normal `ACCESS_NETWORK_STATE` permission.
It requests no runtime permission and never reads SSID, BSSID, MAC addresses,
location, or phone identity. It never collects, stores, or exposes IP address
values; Android only checks each address family to report IPv4/IPv6 support. It
includes no analytics or telemetry and collects no data.

Android cellular generation is the sole optional permission-dependent field.
If the **host app** already declares and receives `READ_PHONE_STATE`, the library
uses it to map the cellular radio technology. The library does not declare or
request that permission; without it, `cellularGeneration` is `null`.

The iOS pod includes a privacy manifest declaring no tracking and no collected
data. It declares Apple's System Boot Time required-reason API category with
reason `35F9.1` because monotonic uptime is used only to measure elapsed probe
and throttling intervals.

Active probes contact the configured endpoints as described above. They run
only after an explicit call or after the app explicitly enables auto-probing.

## Battery and performance

Monitoring is callback-driven; there is no native polling loop. Native updates
are de-duplicated, minor bandwidth/signal changes are thresholded, and the
default trailing-edge throttle is one second. Significant changes such as
connectivity or transport transitions emit immediately. Native I/O and snapshot
processing run away from the main thread, and all callbacks, monitors, timers,
sessions, and executors are released when monitoring stops or the module is
invalidated during reload.

Active probing is the only operation that intentionally generates network
traffic. Choose intervals conservatively and keep the expensive/constrained
safeguards enabled unless the product explicitly requires otherwise.

## Testing in your app

The package ships a Jest mock with the same public surface and a fixed good
Wi-Fi state:

```js
jest.mock('rn-network-quality', () => require('rn-network-quality/mock'));
```

For a reusable manual mock, create `__mocks__/rn-network-quality.js` in the host
app with the same export:

```js
module.exports = require('rn-network-quality/mock');
```

The mock performs no native I/O. Its listener supplies the stable fixed state
on a microtask, and its probe API resolves a fixed Wi-Fi result, making it
suitable for component tests.

## Comparison with `@react-native-community/netinfo`

The packages are complementary rather than drop-in replacements.

| Capability                  | `rn-network-quality`                                            | `@react-native-community/netinfo`                          |
| --------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- |
| Primary purpose             | Actionable link-quality signals and tiering                     | Broad connectivity and connection metadata                 |
| Quality classifier          | Built in and configurable                                       | Application-defined                                        |
| Active RTT/throughput probe | Built in and opt-in                                             | Reachability-oriented checks, not a throughput benchmark   |
| Raw platform signals        | Focused on quality, validation, constraints, and IP/DNS support | Broad connection details across its supported targets      |
| Architecture                | New Architecture only                                           | Choose according to NetInfo's current compatibility matrix |
| Supported targets here      | Android and iOS                                                 | Useful when an app also needs additional targets           |

Keep NetInfo if your app relies on its broader platform coverage or existing
state model. Add `rn-network-quality` when you need measured/estimated link
quality and a consistent decision tier.

## Example app

The included app demonstrates the quality badge, adaptive-video recommendation,
every state field, a 60-sample bandwidth sparkline, manual probing, runtime
settings, event history, immediate snapshots, and Android's optional phone-state
permission flow.

From the repository root:

```sh
yarn install --immutable
yarn example start
```

In another terminal, run one platform:

```sh
yarn example android
yarn example ios
```

For iOS, run `bundle install` in `example/` and
`bundle exec pod install --project-directory=ios` after native dependency
changes. See [`example/README.md`](example/README.md) for network-condition
simulation instructions.

## Troubleshooting

### `E_UNSUPPORTED` or `NetworkQuality` is unavailable

- Confirm React Native's New Architecture is enabled and rebuild the native app.
- Confirm the app uses React Native 0.80 or newer.
- On iOS, run `pod install` in the app's `ios` directory, open the generated
  `.xcworkspace`, clean the build folder if needed, and rebuild.
- On Android, clean the app's Gradle build after changing native dependencies.
- Confirm autolinking includes `rn-network-quality`.
- Expo Go cannot load custom native modules; use an Expo development build or a
  prebuilt native project.

Importing the package is safe on an unsupported platform. `isSupported()`
returns `false`; native-dependent functions throw a helpful `E_UNSUPPORTED`
error.

### iOS Swift generated-header errors

The pod defines the Swift module `rn_network_quality`, while the package name
contains hyphens. Do not copy native source files into the host target. Re-run
Pods installation, ensure the app builds the workspace, and remove stale Xcode
Derived Data if an old generated header remains cached. The library's
Objective-C++ adapter already handles modular and local generated-header forms.

### Values are `null` on iOS

iOS does not publish validation, captive-portal, VPN, roaming, bandwidth,
signal-strength, or upstream-bandwidth values through `NWPathMonitor`. These
fields intentionally remain `null`; use `probeNetwork()` for measured RTT and
downlink throughput.

### Cellular generation is `null`

The iOS simulator has no cellular radio. On Android, the host app must opt into
`READ_PHONE_STATE` and receive runtime approval before this field is read. 5G
NSA may still be reported by Android as LTE/`4g`.

### Emulator results look unrealistic

Virtual devices often report synthetic link speeds, no cellular generation, or
instant transport transitions. Use Android Emulator network speed/delay controls
or Apple's Network Link Conditioner, then validate important behavior on real
hardware.

### A probe has RTT but no downlink result

Read `downloadError` for a timeout, transport error, or rejected endpoint. If it
is `null`, the response may have contained fewer than 32 KB. Android also leaves
downloads completed in under 50 ms as `null`; iOS only requires a positive
measurable body duration. These cases are not treated as request failures, and
latency remains valid by design. Confirm the URL is HTTP(S), returns a body, and
is accessible from the device.

### State is not emitted for every tiny signal change

This is expected. Identical snapshots are removed and small numeric changes are
filtered by `bandwidthChangeThresholdPct`. Larger numeric changes use the
configured trailing-edge throttle. Set `throttleMs: 0` and lower the percentage
only when the extra render and callback volume is acceptable.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, validation commands, native
tests, manual QA, commit conventions, and release administration. Community
participation follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues
should be reported through the private process in [SECURITY.md](SECURITY.md).

## Versioning

Releases follow Semantic Versioning and Conventional Commits. `fix:` changes
drive patch releases, `feat:` changes drive minor releases, and breaking changes
drive major releases. Before 1.0, breaking changes increase the minor version.
Release notes and `CHANGELOG.md` are generated by `release-it`.

## License

[MIT](LICENSE) © 2026 kruthik
