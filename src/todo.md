# PostgreSQL Schema Support TODO

## Working rules

- Stop at the end of each phase for approval.
- Do not touch git.
- Keep the work test-first.
- Prefer removable changes over patching around the design.
- If a change starts looking like a hack, stop and ask for approval.
- Avoid process names like `resolve`, `provide` and `define` unless that is truly the concept. Prefer domain names.
- Do not add abstractions unless they remove real complexity or represent a clear domain concept.
- Name tests from the user's perspective, as use cases and observable behavior.

## Phase 0: compatibility and option resolution

- [x] Start phase and define scope
- [x] Add failing resolver/compatibility tests
- [x] Confirm the tests fail for the expected reason
- [x] Implement internal schema option model
- [x] Run focused tests
- [x] Run formatting/checks
- [x] Stop for approval before Phase 1

## Phase 1: generated and migrated core schema

- [ ] Waiting for approval

## Phase 2: core append and read isolation

- [ ] Waiting for approval

## Phase 3: checkpoints, locks, processors and hooks

- [ ] Waiting for approval

## Later phases

- [ ] Pongo/raw projection forwarding
- [ ] Consumers/sessions/alternate connections
- [ ] Identifier safety/regression/docs
- [ ] SQLite follow-up PR
