# PostgreSQL Schema Support TODO

## Working rules

- Stop at the end of each phase for approval.
- Do not touch git.
- Keep the work test-first.
- Prefer removable changes over patching around the design.
- If a change starts looking like a hack, stop and ask for approval.
- Avoid process names like `resolve`, `provide` and `define` unless that is truly the concept. Prefer domain names.
- Do not add abstractions unless they remove real complexity or represent a clear domain concept.
- Names must match the actual database concept. For PostgreSQL table/sequence references, prefer a relation-oriented name over an event-store-table name.
- Name tests from the user's perspective, as use cases and observable behavior.
- Before claiming a phase works, run `npm run build:ts`, `npm run fix`, `npm run test:unit` and all touched tests, then fix any issues found.
- If running all integration or e2e test suites is needed, ask Oskar.
- The current schema migration must ignore hash mismatches explicitly.
- Do not manually escape or wrap identifiers/literals with `"` or `'` in Emmett. Use Dumbo primitives or change the SQL shape.

## Phase 0: compatibility and option resolution

- [x] Start phase and define scope
- [x] Add failing resolver/compatibility tests
- [x] Confirm the tests fail for the expected reason
- [x] Implement internal schema option model
- [x] Run focused tests
- [x] Run formatting/checks
- [x] Stop for approval before Phase 1

## Phase 1: generated and migrated core schema

- [x] Start phase after approval
- [x] Add missing migration table name option tests from Phase 0
- [x] Implement missing migration table name forwarding
- [x] Add failing generated schema SQL tests
- [x] Add failing migration placement tests
- [x] Implement schema-qualified core schema generation
- [x] Add fresh-schema migration integration coverage for named event and migration schemas
- [x] Add mixed-schema migration integration coverage for event, projection and migration-table names
- [x] Run focused tests and formatting
- [x] Run `npm run build:ts`
- [x] Run `npm run fix`
- [x] Run `npm run test:unit`
- [x] Review for consistency, naming, dead code, and redundant abstractions; fix only clear issues and ask Oskar when unsure
- [x] Check follow-up changes for Dumbo and Pongo, and note them in `research.md` and `plan.md`
- [ ] Stop for approval before Phase 2

## Phase 2: core append and read isolation

- [x] Started after approval
- [x] Add failing user-facing tests proving runtime isolation between configured schemas.
- [x] Make runtime function calls use the configured event-store schema instead of unqualified function names.
- [x] Make runtime table reads/writes use the configured event-store schema instead of unqualified table names.
- [x] Run focused tests and formatting
- [x] Run `npm run build:ts`
- [x] Run `npm run fix`
- [x] Run `npm run test:unit`
- [x] Review for consistency, naming, dead code, and redundant abstractions; fix only clear issues and ask Oskar when unsure
- [x] Stop for approval before Phase 3

## Phase 3: checkpoints, locks, processors and hooks

- [x] Started after approval
- [x] Add failing user-facing tests proving processors use configured schema for checkpoints and locks
- [x] Add failing user-facing tests proving projection registration and locks use configured schema
- [x] Make consumer and processor lifecycle operations use the configured event-store schema consistently
- [x] Make PostgreSQL projection management operations use the configured event-store schema consistently
- [x] Run focused tests and formatting
- [x] Run `npm run build:ts`
- [x] Run `npm run fix`
- [x] Run `npm run test:unit`
- [x] Review for consistency, naming, dead code, and redundant abstractions; fix only clear issues and ask Oskar when unsure
- [x] Check follow-up changes for Dumbo and Pongo, and note them in `research.md` and `plan.md`
- [x] Move schema hook coverage to the schema suite and keep consumer runtime schema checks in a dedicated consumer spec
- [x] Keep Pongo projection helpers from passing both a pool and a transaction client, and close the ambient-client Pongo clients in `finally`
- [ ] Stop for approval before Phase 4

## Later phases

- [ ] Pongo/raw projection forwarding
- [ ] Consumers/sessions/alternate connections
- [ ] Identifier safety/regression/docs
- [ ] SQLite follow-up PR
