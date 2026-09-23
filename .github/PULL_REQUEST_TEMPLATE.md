## Summary

Describe the user-visible problem and the solution in this pull request.

## Validation

List the commands run and the Android/iOS devices, emulators, or simulators used.

## Checklist

- [ ] The pull-request title follows Conventional Commits.
- [ ] `yarn lint`, `yarn typecheck`, and relevant tests pass.
- [ ] New behavior and regressions have automated tests.
- [ ] Public API, defaults, platform semantics, privacy, and traffic changes are documented.
- [ ] The package contains no new third-party runtime dependency.
- [ ] Android behavior was tested, or the reason it is not applicable is explained above.
- [ ] iOS behavior was tested, or the reason it is not applicable is explained above.
- [ ] Native resources, callbacks, monitors, sessions, executors, and timers are cleaned up.
- [ ] Permission and privacy-manifest effects were reviewed.
- [ ] `npm pack --dry-run --json` contains only intended publish artifacts when packaging changed.

## Breaking change

Explain any migration required by consumers. If there is none, state that this is backward-compatible.
