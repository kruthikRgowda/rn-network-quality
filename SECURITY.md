# Security policy

## Supported versions

Security fixes are provided for the latest published minor line. Pre-1.0
versions can contain intentional breaking changes between minor releases, so
applications should upgrade to the newest release before reporting an issue
that may already be fixed.

| Version                  | Supported |
| ------------------------ | --------- |
| Latest published release | Yes       |
| Older releases           | No        |

## Report a vulnerability privately

Do not open a public issue, discussion, or pull request for a suspected
vulnerability. Use GitHub's
[private vulnerability reporting form](https://github.com/kruthikRgowda/rn-network-quality/security/advisories/new).

Include:

- the affected package version and React Native version;
- Android/iOS and OS version;
- whether a device or simulator/emulator was used;
- a clear description of the impact and attack scenario;
- minimal reproduction steps or a private reproducer;
- relevant logs with credentials, tokens, host-app data, and personal data
  removed; and
- any mitigation or patch you have already tested.

The maintainer will acknowledge a complete report within five business days,
investigate it privately, and coordinate a fix and disclosure timeline based on
severity. Please allow a reasonable remediation window before public disclosure.

## Scope

Security reports may cover the published JavaScript/TypeScript package, Android
and iOS native code, active-probe URL handling, release artifacts, and repository
automation. General bugs, feature requests, emulator limitations, and expected
platform `null` values belong in the public issue tracker.

Never include an npm token, signing material, production endpoint credential,
or user network data in any report.
