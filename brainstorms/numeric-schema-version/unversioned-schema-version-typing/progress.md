# Progress: typing `schemaVersion` on unversioned messages

Scratch folder: /tmp/claude-1000/-home-oskar-repos-emmett/445d50e8-12b7-4065-8e97-b4c5a961da8a/scratchpad/poc-schema-version/

## Step 1: usage of the bare constraint (done)

Scanned 790 `.ts` files under `src/packages/*/src` (no `lib/`, `node_modules`, `dist`). Bare constraint (not followed by `<`): `extends Event` 265 in 36 files, `extends Message` 104 in 37 files, `extends Command` 12 in 4 files. Defaults: `= Event` 73 in 28 files, `= Message` 25 in 13 files, `= Command` 1. `AnyEvent` 134 in 23 files, `AnyMessage` 225 in 40 files, `AnyCommand` 88 in 15 files. `Event[]` 34 in 11 files.

## Step 2: candidates (done)

Shared check file `checks.ts` (sections a to h, must compile with 0 errors) and observation file `report.ts` (b3, e2 to e5) compiled with `tsc --noEmit --strict` against each candidate `typing.ts`.

- A (`?: number`): 21 errors. Fails a, c, f, g. Passes b, d, e, h.
- B (`?: 1`): 31 errors. Fails d, e, f (constraint), plus the default-branch checks.
- C (conditional on `string extends Type`, version optional): 8 errors. `case 2` narrows (criterion 1.1 passes), but `default`/`case 1` still sees `D1 | D2` because `schemaVersion?: 2` also allows `undefined`. Passes b, d, e, f, h.
- D (fourth param default `string extends Type ? number : 1`, version optional): same 8 errors as C.
- D0 (fourth param default `number`): same as A.
- G (no `schemaVersion` key on unversioned): 29 errors, `switch` on the union fails with TS2339.
- Creq (C, but a declared version is required): 0 errors.
- Dreq (D, but a declared version other than 1 is required): 0 errors.
- E (A plus `isSchemaVersion` type guard): switch checks fail as in A, guard-based checks pass with 0 errors.

## Step 3: apply to real emmett package (done)

All packages and docs snippets checked from a scratch copy with `tsc -p tsconfig.eslint.json --noEmit`. With only the message types changed: A, C, D, CreqA and Dreq give 0 new errors, Creq gives 121. Check i (handler for `V1 | V2` where an `AnyEvent` handler is expected) was added after this run and fails only for Creq.

## Step 4: write-up (done)

`findings.md` was saved by the main session, because the subagent could not write report files. The main session re-ran `checks.ts` and `usage.ts` per candidate: A 25 errors, C 10, D 10, CreqA 0, Dreq 0.
