# rn-network-quality example

This React Native Community CLI app exercises the complete required feature set:

- live quality tier, source, and classifier reasons;
- every native snapshot field;
- a 60-sample bandwidth sparkline;
- manual and automatic active probes;
- monitoring throttle and classifier threshold presets;
- one-shot snapshots and a 50-entry field-change log; and
- optional Android phone-state permission for cellular generation.

## Run it

From the repository root:

```sh
corepack yarn install --immutable
corepack yarn example android
```

For iOS, install pods once after dependency or podspec changes:

```sh
cd example
bundle install
cd ios
bundle exec pod install
cd ../../
corepack yarn example ios
```

The app uses React Native's New Architecture. Expo Go cannot load this native
module; use this app or an Expo development build instead.

## Simulate network conditions

### Android emulator

Open **Extended Controls → Cellular** to change the network type and signal
strength. You can also use:

```sh
adb emu network speed gsm
adb emu network delay edge
adb emu network speed full
adb emu network delay none
```

Toggle airplane mode to exercise offline recovery. Enable Android Data Saver to
observe `isConstrained`. Switch between Wi-Fi and cellular to verify transport
changes and probe invalidation. A VPN can be used to verify `isVpn` while the
underlying Wi-Fi or cellular transport remains the primary `transport` value.

The **Grant phone state (optional)** button requests `READ_PHONE_STATE` from the
example app only. Grant it while using cellular to demonstrate
`cellularGeneration`; the library never declares or requests this permission.

### iOS simulator and devices

Use **Network Link Conditioner** to apply latency, packet-loss, and bandwidth
profiles. On a physical device it is available under **Settings → Developer**.
For the simulator, install Network Link Conditioner from Xcode's Additional
Tools package. Toggle airplane mode or Wi-Fi on a device, and enable Low Data
Mode to observe `isConstrained`.

iOS does not expose passive bandwidth, validation, captive-portal, VPN, roaming,
or signal-strength values through `NWPathMonitor`; those rows correctly display
“not available on this platform.” Run an active probe to populate RTT and
downlink measurements.

## Useful manual checks

1. Start online and confirm exactly one initial event appears.
2. Toggle airplane mode and confirm `offline`, then reconnect.
3. Switch Wi-Fi/cellular and verify a prior probe no longer affects the tier.
4. Background and foreground the app with auto-probe enabled.
5. Change throttle and threshold presets while monitoring.
6. Reload JavaScript and use Fast Refresh; events must not duplicate.
7. Test a captive portal, Data Saver/Low Data Mode, VPN, and a deliberately slow
   connection where available.
