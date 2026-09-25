# Contributing to rn-network-quality

Thank you for helping improve `rn-network-quality`. By participating, you agree
to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md), not in a public issue.

## Prerequisites

- macOS for work that needs both Android and iOS verification
- Node.js 24.21.0, pinned by `.nvmrc`
- Corepack and the repository's Yarn 4.11.0 release
- JDK 17
- Android Studio/SDK with API 37 compile tools, API 36 target support, and an
  API 24 or newer emulator/device
- Xcode 16.1 or newer; iOS 15.1 is the library's minimum deployment target
- Ruby Bundler and CocoaPods for the example iOS app

The library currently develops against React Native 0.87.1. Its published peer
floor is React Native 0.80.0 because that release's Codegen parser supports the
`CodegenTypes.EventEmitter` property syntax used by the TurboModule spec. The
New Architecture must be enabled.

## Set up the repository

```sh
git clone https://github.com/kruthikRgowda/rn-network-quality
cd rn-network-quality
nvm use
corepack enable
yarn install --immutable
```

Install the example app's iOS dependencies when working on iOS:

```sh
cd example
bundle install
bundle exec pod install --project-directory=ios
cd ..
```

Start Metro from the repository root:

```sh
yarn example start
```

Then use another terminal for a native target:

```sh
yarn example android
yarn example ios
```

Native source changes require rebuilding the app. JavaScript-only changes are
normally picked up by Fast Refresh.

## Project structure

| Path                          | Responsibility                                               |
| ----------------------------- | ------------------------------------------------------------ |
| `src/NativeNetworkQuality.ts` | The only Codegen input and native contract                   |
| `src/types.ts`                | Public TypeScript data model                                 |
| `src/classify.ts`             | Pure quality classifier                                      |
| `src/normalize.ts`            | Native-value validation and narrowing                        |
| `src/manager.ts`              | Monitoring, state, probe, and auto-probe orchestration       |
| `src/hooks.ts`                | React hooks                                                  |
| `src/index.tsx`               | Public exports                                               |
| `android/`                    | Kotlin TurboModule, monitor, snapshots, throttler, and probe |
| `ios/`                        | Swift implementation and Objective-C++ TurboModule adapter   |
| `example/`                    | React Native 0.87.1 demonstration app                        |
| `mock.js`                     | Published consumer Jest mock                                 |
| `.github/`                    | CI, release automation, and community templates              |

Keep the public TypeScript types as the source of truth. Codegen types may be
broader when the parser requires it; normalize them before exposing them.

## Development commands

Run commands from the repository root unless a command changes directory.

| Command                | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `yarn lint`            | Run ESLint, including configured formatting rules          |
| `yarn lint:fix`        | Apply safe lint/format fixes                               |
| `yarn typecheck`       | Type-check the library, tests, and configured examples     |
| `yarn test`            | Run TypeScript/Jest tests                                  |
| `yarn test:coverage`   | Run tests with the repository coverage thresholds          |
| `yarn codegen:check`   | Generate Android/iOS Codegen artifacts in a temporary tree |
| `yarn prepare`         | Build ESM output and TypeScript declarations with Bob      |
| `yarn pack:check`      | Inspect the npm dry-run manifest and enforce package scope |
| `yarn clean`           | Remove generated library and native build output           |
| `yarn example start`   | Start Metro for the example app                            |
| `yarn example android` | Build and run the Android example                          |
| `yarn example ios`     | Build and run the iOS example                              |
| `yarn commitlint`      | Validate a supplied commit message file                    |
| `yarn release`         | Run `release-it`; maintainers use this through CI          |

Before opening a pull request, run:

```sh
yarn lint
yarn typecheck
yarn test:coverage
yarn codegen:check
yarn prepare
yarn pack:check
```

Inspect the pack output. It must include the built library, source, native
implementations, podspec, privacy manifest, and `mock.js`; it must not include
the example app, tests, coverage, or native build directories.

## TypeScript tests

Jest covers normalization, every classifier boundary, monitoring reference
counts, probe de-duplication, auto-probe policy, lifecycle behavior, and hooks.
Keep line coverage for `src/` at or above 90%, excluding the generated/native
spec contract. Use fake timers for interval and debounce behavior and restore
them after each test.

```sh
yarn test
yarn test:coverage
```

Consumer-facing tests should load the published mock exactly as an application
would:

```js
jest.mock('rn-network-quality', () => require('rn-network-quality/mock'));
```

## Android development and tests

The library's JVM-only tests exercise pure mapper and throttler logic without a
device or Robolectric. Through the example Gradle project, run:

```sh
cd example/android
./gradlew :rn-network-quality:testDebugUnitTest
./gradlew :app:assembleDebug
cd ../..
```

Use JDK 17. If autolinking generates a differently normalized library project
name in a future React Native release, run `./gradlew projects` and use the
listed `rn-network-quality` library path.

The library manifest must continue to declare only the normal
`ACCESS_NETWORK_STATE` permission. The example app may declare
`READ_PHONE_STATE` solely to demonstrate the host-controlled opt-in cellular
generation field.

## iOS development and build

Install Pods after changing Codegen or native dependencies, then build the
workspace rather than the project:

```sh
cd example
bundle exec pod install --project-directory=ios
cd ios
xcodebuild \
  -workspace RnNetworkQualityExample.xcworkspace \
  -scheme RnNetworkQualityExample \
  -sdk iphonesimulator \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  build
cd ../..
```

`NWPathMonitor` instances cannot be restarted after cancellation. Changes to
the monitoring lifecycle must preserve the create-on-start, cancel-on-stop
behavior and clean up on module invalidation. Keep Swift-visible adapter
methods Objective-C representable, and keep the included privacy manifest in
the pod's resource bundle.

## Manual QA checklist

Run this checklist on real devices when practical. Exercise both Android and
iOS unless the row is platform-specific.

- [ ] Launch online and confirm exactly one initial event arrives.
- [ ] Enable airplane mode, verify `offline`, then disable it and verify recovery.
- [ ] Move between Wi-Fi and cellular; confirm transport changes and stale probe
      measurements stop influencing the tier.
- [ ] Toggle a VPN on Android; confirm `isVpn` changes while the underlying
      transport still has the documented priority.
- [ ] Enable and disable Android Data Saver and iOS Low Data Mode; confirm
      `isConstrained` updates.
- [ ] Join a captive-portal network on Android; confirm the portal/validation
      fields and `poor` classification when Android exposes them.
- [ ] Background and foreground the app; confirm auto-probing pauses and resumes
      while OS monitoring continues according to platform lifecycle.
- [ ] Reload JavaScript and use Fast Refresh repeatedly; confirm there are no
      duplicate events, leaked callbacks, receivers, timers, or monitors.
- [ ] Probe with a malformed URL and confirm `E_INVALID_URL`.
- [ ] Probe while offline and confirm `E_OFFLINE`.
- [ ] Probe on a slow/throttled network and confirm timeout or partial-download
      behavior is represented by the documented error/result fields.
- [ ] Run a latency-only probe with `downloadUrl: null` and confirm no throughput
      download occurs.
- [ ] Enable auto-probing and verify expensive/constrained connections are
      skipped unless their allow flags are explicitly enabled.
- [ ] Add and remove multiple listeners; confirm monitoring starts for the first
      and stops only after the last is removed.
- [ ] On Android, deny and then grant the example's phone-state permission;
      confirm the library remains usable and cellular generation changes only
      when the OS can provide it.
- [ ] On the iOS simulator, confirm unavailable cellular and bandwidth values
      remain `null`, not fabricated values.

Useful condition controls are documented in
[`example/README.md`](example/README.md).

## Documentation changes

Update the README whenever behavior, defaults, public types, platform support,
permissions, probe traffic, or errors change. Examples must use exported APIs
and valid TypeScript. Keep platform-unavailable values documented as `null` and
do not imply that an OS estimate is a measured speed test.

## Commit and pull-request conventions

Use Conventional Commits. The commit-msg hook and pull-request title check use
the same convention:

```text
feat: add a configurable probe sample count
fix(android): release the network callback on reload
docs: explain constrained-network policy
test(ios): cover trailing throttle delivery
```

Use `BREAKING CHANGE:` in the commit footer when a change breaks consumers.
Before version 1.0, breaking changes produce a minor release; afterward they
produce a major release.

Keep pull requests focused. Explain the user-visible behavior, link a related
issue when one exists, update tests and documentation, and record the devices or
simulators used. Complete every applicable item in the pull-request template.

## Release process

Only maintainers release packages. The Release workflow validates the project,
runs `release-it`, updates `CHANGELOG.md`, creates a release commit and `vX.Y.Z`
tag, publishes a GitHub Release, and publishes to npm with provenance.

Conventional Commits determine automatic versions:

- `fix:` → patch
- `feat:` → minor
- `BREAKING CHANGE:` → major (minor while the package is below 1.0)

The workflow accepts `auto`, `patch`, `minor`, `major`, or `prerelease`. On a
repository with no existing `v*` release tag, `auto` uses release-it's
no-increment path and publishes the existing `0.1.0` version. After that first
tag exists, `auto` derives the next version from Conventional Commits. A
prerelease uses the `beta` prerelease name and npm dist-tag.

### Protect `main` and allow release automation

The Release workflow pushes its release commit and tag directly from `main`.
Use a dedicated GitHub App as the only automation bypass instead of giving the
default `GITHUB_TOKEN` or every administrator a broad exception:

1. In your GitHub account, open **Settings → Developer settings → GitHub Apps →
   New GitHub App**. Give the app a unique name such as
   `rn-network-quality-release`, disable webhooks, and grant only the repository
   **Contents: Read and write** permission.
2. Install the app for **Only select repositories** and select
   `kruthikRgowda/rn-network-quality`.
3. Generate a private key. In the repository's **Settings → Secrets and
   variables → Actions**, save the app's Client ID as the repository variable
   `RELEASE_APP_CLIENT_ID` and the complete private key as the repository secret
   `RELEASE_APP_PRIVATE_KEY`.
4. Open **Settings → Rules → Rulesets → New branch ruleset**. Name it
   `Protect main`, set enforcement to **Active**, and target the default branch
   (`main`).
5. In **Bypass list**, add only the installed release GitHub App and choose
   **Always allow**. The release workflow uses this short-lived app token for
   checkout, its release commit and tag push, and GitHub Release creation.
6. Enable **Restrict deletions**, **Require a pull request before merging**, and
   **Block force pushes**. Set required approvals to `0`; leave code-owner review
   requirements off unless maintainers are added later.
7. Enable **Require status checks to pass** and add all six CI job names exactly:
   **Conventional PR title**, **Lint and typecheck**, **TypeScript tests**,
   **Build and inspect package**, **Android example and JVM tests**, and
   **iOS example**. Requiring branches to be up to date before merging is
   recommended.

Ordinary contributors and the default workflow token cannot bypass this
ruleset. The release app can bypass it only because it is explicitly listed;
keep that app installed only on this repository and do not reuse its private
key elsewhere.

### First npm publication

npm trusted publishing can only be configured after the npm package exists.
The initial `0.1.0` publication therefore requires a token:

1. Sign in to npm as an owner allowed to publish `rn-network-quality`.
2. Create a short-expiry granular access token with **All Packages**, **Read and
   write (publish and stage)**, and **Bypass 2FA**. Revoke it immediately after
   the first publication.
3. In `kruthikRgowda/rn-network-quality`, create the GitHub Actions repository
   secret `NPM_TOKEN` containing that token.
4. From the `main` branch's Actions tab, run the **Release** workflow with the
   `auto` increment. With no existing `v*` tag, the workflow publishes the
   existing `0.1.0` version without incrementing it.
5. Confirm the package, provenance statement, Git tag, GitHub Release, and
   generated changelog are present before revoking or rotating the token.

Never commit an npm token or put it in a workflow file.

### Configure npm trusted publishing after the first release

After `rn-network-quality` exists on npm:

1. Open the package's npm **Settings → Trusted Publisher** configuration.
2. Choose GitHub Actions and set owner `kruthikRgowda`, repository
   `rn-network-quality`, workflow filename `release.yml`, and environment
   `npm`. These values must match the release job exactly.
3. Set the allowed action to direct **`npm publish`**; the workflow does not use
   staged publishing.
4. Keep the workflow's `id-token: write` permission and use a current npm CLI.
5. Remove the `NPM_TOKEN` repository secret so the next release proves the OIDC
   path works without token fallback.
6. Run a patch or beta release and verify npm displays provenance.

The workflow supports `NPM_TOKEN` as a fallback for registries or accounts where
trusted publishing is unavailable. Prefer OIDC for normal releases because it
does not store a long-lived publishing credential.

### Running a release

1. Ensure CI is green on `main` and the working tree is clean.
2. Review unreleased Conventional Commits and select `auto` unless a deliberate
   increment is needed.
3. Run the **Release** workflow from GitHub Actions.
4. Verify the release commit, tag, changelog, GitHub Release, npm dist-tag, and
   package contents.

Do not run a production publish from an unreviewed local working tree.
