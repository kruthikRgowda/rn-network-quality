# Build preflight

Checked on 2026-09-23 before implementation.

| Tool                        | Detected version                  | Status                                                                      |
| --------------------------- | --------------------------------- | --------------------------------------------------------------------------- |
| Node.js                     | 26.8.1                            | Available; the project pins the current LTS, 24.21.0, in `.nvmrc`           |
| npm                         | 11.19.0                           | Available                                                                   |
| Yarn                        | 4.11.0                            | Bundled in `.yarn/releases` and invoked through Corepack                    |
| React Native                | 0.87.1                            | Current stable selected for the example app                                 |
| create-react-native-library | 0.63.1                            | Current stable used for the scaffold                                        |
| Java                        | Temurin 17.0.20.1                 | Available and compatible with the Android build                             |
| Android platform tools      | SDK under `~/Library/Android/sdk` | `adb` available                                                             |
| Xcode                       | 26.6 (17F113)                     | Available                                                                   |
| Swift                       | 6.3.3                             | Available; library code remains Swift 5.9 compatible                        |
| CocoaPods                   | 1.15.2                            | Installed project-locally through the example's Bundler setup               |
| actionlint                  | —                                 | Not installed; workflow syntax is checked by tests and local command review |

The npm registry returned `E404` for `rn-network-quality`, so the unscoped name was
available at preflight time. Registry availability can change before publication.

The scaffold CLI currently accepts `kotlin-objc`, but not `kotlin-swift`, for a
TurboModule. The generated Objective-C implementation is therefore replaced by the
required Objective-C++ adapter and Swift implementation during the iOS phase.
