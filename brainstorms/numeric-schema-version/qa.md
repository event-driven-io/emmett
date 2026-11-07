# Numeric schema version: Q&A

## Q1. What's the idea?

> I'd like to set event schema version to number and projection number to number, I'd like to also keep schemaversion in the top level of message, currently we keep it as string, but it's just making things unclear

## Q2. Which projection value should become a number: a string projection version I missed, the projection's `version`, or something else (e.g. MongoDB's projection document `schemaVersion`)?

> I mean projection definition version

## Q3. The projection definition version is already a `number`. Should anything about it change (e.g. required, different default), or is only the event schema version in scope?

> is it also stored like that? no, not required.

## Q4. What should a message look like after the change (appended vs read back), where does `schemaVersion` sit, and does `metadata` keep a copy?

> I think that schemaVersion should be moved out of metadata to the dedicated numeric string. this will allow better union type on multiple versions of the message. Also it's not only about events, it's about message. Also I recently aligned it to be text, which was wrong, we need to correct it. We can keep copy, or just clone it upon read. Thoughts?

## Q5. Keep a copy of `schemaVersion` in metadata, or clone it on read from the column? If clone on read, what should the migration write into `message_schema_version` for rows appended before this change?

> Some people already use 0.43.0 on prod. We need to be backward compatible. I'd prefer to do migration of structure and data, but I'm afraid it'd be costful. I don't want to be dragged by old mistakes.

## Q6. Does backward compatibility mean old stored data must read correctly, or must code written against 0.43.0 (string `metadata.schemaVersion`) also keep compiling and working unchanged?

> Yes, old data need to be read correctly

## Q7. May code written against 0.43.0 (string `metadata.schemaVersion` on append and in upcasters) break on upgrade with release notes, or must it keep working for a while?

> yes, such code can break

## Q8. Which migration cost is acceptable for a large production event store: a full rewrite of the messages table, only instant metadata-level schema changes, or something in between (e.g. a rewrite users run themselves)?

> Can we have new table for new users and old for old and read it properly? And yes, we should at least provide script to do rewrite on demand

## Q9. In an existing store that has not run the rewrite, how should a reader tell trustworthy `message_schema_version` column values from the pre-`2090840b` junk? Or is the rewrite the only way there, with the version coming from the metadata JSON until a store runs it?

> by script, I mean function, like we did in past for some migrations

## Q10. Which past migration should the on-demand rewrite follow (Emmett, a branch, a sample, Pongo or Dumbo)? How is it called, SQL or TypeScript function, batched or not?

> I mean to provide the function and migration that's not plugged to regular ones, but will be run on demand.

## Q11. Until a store runs the on-demand migration, where should reads take the schema version from? Should appends to such a store keep writing `schemaVersion` into the metadata JSON so old and new rows stay distinguishable?

> also if we change the structure we should run column tetris, as probably the number column may be put in a different place. to the question. it should take first from column then from metadata, and have some fallback for non-numeric string value (e.g. "1")

## Q12. How should reads handle SQLite rows from before `2090840b`, where the column holds a numeric stream version instead of a schema version?

> where the column holds a numeric stream version instead of a schema version - I don't understand

## Q12 (rephrased with an example). How should reads handle old SQLite rows (0.42.x), where `message_schema_version` holds the stream's expected version (e.g. `0`, `1`, `2`) — a valid number that isn't the schema version?

> also for the migration function, we should allow to provide their own "migrator" sql so they could migrate e.g. "v2". About sqlite, could we then ignore this and read from message metadata? Also for SQLite I'm fine migrating it automatically to the proper state.

## Q13. For SQLite: automatic migration (rebuild with an `INT` column, then read from the column only) or no migration (read from metadata, ignore the column)?

> If metadata can contain proper values then yes, also from metadata, if they're for sure junk then not.

## Q14. What should a non-numeric value (e.g. PostgreSQL junk `'"1"'`, user values `'v2'`, `'2.0'`, `'two'`) become during reads before migration and during the automatic SQLite migration: `1`, an error, or digits extracted from the string?

> I think that let's do 1 for now.

## Q15. How should two versions of the same event be declared as a union type, how would an upcaster switch on them, and is `schemaVersion` optional or required on the message?

> event should have optional schema version the same as it has kind

## Q16. How should a user give the version literal on their type: a fourth type parameter on `Event` (and `Command`), e.g. `Event<'ProductItemAdded', Data, undefined, 2>`, intersecting it themselves, or something else?

> As said, it's for messages, not only foor events, and it should be the last parameter for now, unless you have a better idea.

## Q17. Should `metadata.schemaVersion` exist at all after the change (removed from `CommonRecordedMessageMetadata`, not written into `message_metadata` JSON, reads setting only top-level `schemaVersion`)?

> Recroded message should have requires schemaversion btw. I think that there's no point of metadata.schemaVersion, unless you see it?

## Q18. Do you need to support mixed 0.43.0 and new instances reading the same store during an upgrade (blue/green, rolling), or can release notes say to upgrade all instances before appending `schemaVersion > 1`?

> it'd be good to have blue green capability if possible and not a hhuge cost

## Q19. Should reads strip the JSON copy of `schemaVersion` from `metadata`, so recorded messages show only the top-level number, or leave it in `metadata`?

> yes, it should strip

## Q20. Should MongoDB, EventStoreDB and the in-memory store fully store and return `schemaVersion` in this work, or only return `1` for now?

> Store and return

## Q21. Should appends validate `schemaVersion` (e.g. only positive integers `>= 1`)? If yes, fail with an Emmett error before touching the database, or replace with `1`?

> not for now

## Q22. Should `schemaVersion` returned by `upcast` and `downcast` replace the original one, as `data` does (downcast to `1` stores `1`; upcast to `2` gives a recorded message with `schemaVersion: 2`)?

> i think so, thoughts?

## Q23. When `upcast` or `downcast` returns no `schemaVersion`, should the original value be kept, or should something else happen?

> yes, original

## Q24. What should a user pass as their migrator (SQL expression per row, whole SQL statement, TypeScript mapping), and what can it see (only old `message_schema_version`, or the whole row incl. `message_type`, `message_metadata`)?

> Cases would be simplest, thought?

## Q25. Combining the user's `CASE` with the default rules via `COALESCE`: should the user's `CASE` run first and override, or only fill in what the default rules couldn't parse?

> user first

> (follow-up) user first, but allowing to fallback to the defaults

## Q26. How should the on-demand rebuild run on a live system: block writes for the whole copy, online in batches with minimal locking, or blocking now with online later?

> I was more thinking about the altering but not doing the full tetris reorder

## Q27. The in-place `ALTER ... TYPE INT USING ...` takes an `ACCESS EXCLUSIVE` lock (blocks reads and writes) and rewrites the table and indexes. Is that acceptable with docs recommending a maintenance window, or should the function reduce the impact (e.g. `lock_timeout`)?

> That's wy I said it should be run on demand and we still should support the old type for some time.

## Q28. How should a user call the on-demand migration and pass their `CASE`: exported TypeScript function in `@event-driven-io/emmett-postgresql`, SQL function installed in the database, the `migrate` CLI command, or more than one?

> We should also provide the migration with proper column tetris

## Q29. Should the tetris rebuild run under the same terms as the `ALTER` (one transaction, table locked for reads and writes, maintenance window), or online with appends continuing during the copy?

> It should pass as an SQL that we concatenate

> About q29, i'm not sure what options we have, it'd be best if it was online, or at least readonly

> (follow-up) definitely no data loss is acceptable

## Q30. Which approach should the tetris rebuild use: read-only (one transaction, `EXCLUSIVE` lock blocks writes, reads continue), online (trigger + batched copy + short final lock), or read-only now with online later?

> isn't online super tricky? I'd probably start with read-only and add 2nd if people need it

## Q28 (again). How should a user start one of the on-demand migrations: exported TypeScript function, a Dumbo `SQLMigration` they add to their own run, the `migrate` CLI command, or more than one?

> They'll call it somewhere wherever they want. See how rebuild looks like

## Q31. Should the in-place `ALTER` and the read-only tetris rebuild be two separate exported functions, or one function with an option that picks the variant (and if one, which is the default)?

> I don't understand the question about two functions

## Q31 (again, with code). One exported function per variant (`migrateA(...)`, `migrateB(...)`) or one function with an option (`migrate({ ..., mode: 'alter' | 'rebuild' })`)? If one function, what happens without the option?

> Is alter costly?

## Q32. Given the `ALTER` costs about the same as the rebuild (full rewrite, indexes, extra disk space) but also blocks reads, do you still want both variants, or only one?

> I think that they should be two different migrations, one is about alter, the other about tetris in general.

## Q33. What should the tetris migration do when the store still has the `TEXT` column: convert values during the copy (same `COALESCE` + optional user `CASE`), refuse and require the schema version migration first, or keep `TEXT` and only reorder?

> Tetris should also rn the message version migration

## Q34. Which release should this ship in, `0.43.0` (before final) or `0.44.0` (next to the checkpoint cleanup)?

> it should be 0.43.0 optional

> (follow-up) or ok, 0.44.0 with checkpoint cleanup

## Q35. Should `event()`, `command()` and `message()` accept `schemaVersion`? If yes, how should it be passed, given positional arguments today and optional `metadata`?

> it should be mandatory if the version is defined on type and optional if not (so version 1)

> (follow-up) as the last param

## Q36. When MongoDB, EventStoreDB and the in-memory store read a message without a stored top-level `schemaVersion`, should they fall back to numeric `metadata.schemaVersion` before `1` (same chain as PostgreSQL), strip it from `metadata`, and write the string copy for blue/green? Or just use `1`?

> yes, it should fallback to 1, this should be consistent across all stores

## Q37. What documentation should this work include (versioned message types and upcasting with `schemaVersion`, a 0.44.0 upgrade guide covering the migrations, PostgreSQL/SQLite event store page updates, or release notes only)?

> definitely we should update upcasting. We don't need to provide dedicated for now

## Q38. Should the spec set an end date for PostgreSQL `TEXT` column support and the blue/green metadata copy, or only describe them as temporary and leave removal to a later decision?

> I think this is out of scope of your role here.

## Spec: test seams. (1) shared event store features across all five stores, (2) old data → migration → current read for PostgreSQL and SQLite, (3) blue/green: current append → frozen 0.43.0 read, (4) unit tests for helpers. Do these match your expectations?

> 1. Yes, plus you can add to the storage method tests. 2.Fine. 3. and the other way round, right? So no migration and reading with new. Also we should check if old api can still run after on-demand migration. 4 fine.

## Spec review. The spec found five points not settled in the Q&A (append function signature, EventStoreDB metadata key, SQLite text in INTEGER column, checkpoint cleanup activation, `lock_timeout`). Go back to Q&A or record decisions directly in the spec?

> yes, lets' get back to qa with those 1-5

## Q39. How should 0.44.0 handle `emt_append_to_stream`, given 0.43.0 and 0.44.0 instances may call it during blue/green, on both `TEXT` and `INT` columns?

> Can we have an overload? SO two function and drop the one with text later in 0.44.0?

## Q40. Which approach for the append function: one `text[]` function that converts values inside to fit the column, a separately named function with `int[]` for 0.44.0 callers (old `emt_append_to_stream` kept for 0.43.0 callers), or something else?

> Probably overload with the new name would be better?

## Q41. Should the automatic 0.44.0 migration rewrite the old `emt_append_to_stream` body so it converts strings to fit the column (unchanged on `TEXT`; numbers with `1` for non-numeric on `INT`), or is it acceptable that 0.43.0 instances can't append after an on-demand migration?

> Also kinda good practice in general for the future, thoughts? to  your question, yes.

## Q42. EventStoreDB: one key (`metadata.schemaVersion: '2'` is both the stored value and the blue/green copy) or two keys (separate numeric key plus the string copy)? If two, which name?

> I don't understand old code keeps it in metadata.schemaVersion, the new maps to schemaVersion and numeric? AM i missing anyting?

## Q43. SQLite after the automatic rebuild: 0.43.0 instances may still insert non-numeric text (e.g. `'v2'`) into the new `INTEGER` column. Is the read rule plus a test enough, or should more happen (e.g. `STRICT` table)?

> I don't understand. SQLite just mandatory migration no blue/green

## Q44. Should SQLite appends skip the string copy in `metadata.schemaVersion` (no 0.43.0 readers), or keep writing it so all five stores store the same thing?

> In general, postgresql also shouldn't store it eventually and sqlite neether, we can keep it for old events, for PG we may just need to do more as there are people running serious production overthere

## Q45. Should MongoDB and the in-memory store also skip the string copy, like SQLite, so only PostgreSQL writes it?

> and reads still parse it as a fallback and strip it. - why? We migrate data to the column
> how esdb and mongodb differ, I don't understand why did you write it differently.

## Q46. Should the SQLite rebuild also remove `schemaVersion` from the stored metadata JSON, so SQLite reads take the version from the column only, with no fallback and no stripping?

> I told you that SQLite for old events can keep the old values.

## Q47. Plugging in the PostgreSQL `0_44_0` set activates the checkpoint cleanup, so 0.44.0 supports blue/green only with 0.43.0, not with 0.42.x. Is that acceptable, or should the cleanup move to a later release?

> Yes

## Q48. Should the on-demand migration functions handle lock waits (e.g. an optional lock timeout that fails the migration, with or without a default), or leave it to the user's own connection settings?

> Yes, we should provide options just like for any migrate call

## Q49. Update `spec.md` with the decisions on points 1–5 now?

> please do

## Follow-up idea (new /brainstorm round)

> I think that we can also run the alter migration for pg as mandatory in 0.44.0, thoughts? We can always postpone that. The "tetris" one should be non-mandatory

## Q50. "We can always postpone that": should users be able to skip or delay the mandatory `ALTER` in 0.44.0 (e.g. an option, keeping `TEXT` until they run it), or ship it as mandatory and move it to a later release if users report problems?

> I mean that before 0.44.0 i can always remove this migration and move to 0.45.0, right?

## Q51. With the `ALTER` mandatory in 0.44.0, should reads and append functions still support the `TEXT` column (so postponing stays a one-line change), or support `INT` only and accept that postponing means adding `TEXT` support back?

> We can drop then old function also, and clean it up, right?

## Q52. One `int[]` function under the old name (0.43.0 instances with non-numeric versions fail to append during blue/green), or keep the separately named function plus a simplified shim?

> we can keep new name, it's fine

## Q53. Does the old `emt_append_to_stream` stay in 0.44.0 as a shim (simplified to convert strings to `INT` only) so 0.43.0 instances can append during blue/green, or is it dropped (ending blue/green for 0.43.0 appends)? (The question as asked contained a typo, `emt_antml_to_stream`.)

> emt_antml_to_stream - wtf?

## Q53 (again). Should the old `emt_append_to_stream` stay in 0.44.0 as a shim (convert strings to `INT` only) so 0.43.0 instances can append during blue/green, or be dropped so appends from 0.43.0 instances fail after the upgrade?

> If we do full migration, then drop it for now as a separate migration both with comment to doublecheck before 0.44.0 release. I can always then rever that

## Q54. Where should users pass their `CASE` for the mandatory `ALTER` (e.g. the event store's schema migration options), or nowhere (automatic run uses defaults only)?

> Dude, I don't understand what are you asking, we already agreed on that

## Q55. Ready to update `spec.md` with this round's changes (mandatory `ALTER` as a separate automatic migration, drop the old `emt_append_to_stream` as a separate migration, remove `TEXT` support, tetris on demand without `CASE`)?

> Dude, mandatory is on 0.44.0 that's future not plugged anywhere!

## Q56. Release split: ships now in the 0.43.0 line (numeric top-level `schemaVersion` in all stores, new append function plus old one converting values, reads handling `TEXT` and `INT`, PostgreSQL metadata copy, SQLite rebuild, new `CREATE TABLE` layout, on-demand tetris migration); prepared in `0_44_0` and left unplugged (mandatory `ALTER`, drop of old `emt_append_to_stream`, each a separate migration with a double-check comment, next to the checkpoint cleanup). Is that the split?

> yes

## Q57. Should the current line still export the on-demand `ALTER` function next to the tetris one (reusing the migration `0_44_0` will make mandatory), or should tetris be the only on-demand migration until 0.44.0?

> DUDE, this is orthogonal, yes, we should export and expect user to run it before 0.44.0

## Q58. What should the database function that takes the versions as `int[]` be called? The existing one, which 0.43.0 instances keep calling, is `emt_append_to_stream`.

> I don't understand the question, expand

## Q58 (again). Today every append calls `emt_append_to_stream(..., v_message_schema_versions text[], ...)`. We agreed to add a second function that takes `int[]`, created by the 0.43.0 automatic migration and called by new code with explicit casts, while `emt_append_to_stream` stays for 0.43.0 instances until the 0.44.0 drop. A same-name overload would make 0.43.0 calls ambiguous, so it needs its own name. What should this second PostgreSQL function be called?

> add _v_0_43_0 suffix

## Q59. What should the exported PostgreSQL package function for the on-demand schema version migration be called? Users call it before upgrading to 0.44.0. It runs the `ALTER` of `message_schema_version` from `TEXT` to `INT`, takes the connection options, an optional user `CASE` fragment and the Dumbo migration options, and has the shape of `rebuildPostgreSQLProjections`.

> call it migrateSchemaToNumericMessaveVersion

Correction given with the Q60 answer:

> call it migrateSchemaToNumericMessageSchemaVersion

## Q60. What should the exported PostgreSQL package function for the on-demand tetris migration be called? Users call it themselves. It rebuilds the messages table with the fresh-install layout (`INT` `message_schema_version` after `created`, before `is_archived`), copies the rows under an `EXCLUSIVE` lock, and has the same shape as the schema version migration function.

> about q60 migrateToOptimisedPostgreSQLStorageLayout

## Q61. Two gaps found while planning: (1) the spec does not name the user `CASE` input on the on-demand functions or the migration options field the prepared 0.44.0 migration reads it from; (2) the spec does not say whether stores with a custom `databaseSchemaName` get the new automatic migrations (PostgreSQL append functions, SQLite rebuild) and the on-demand PostgreSQL migrations. Go back to Q&A for them?

> Name of the user CASE input.  - find something matching, it should be optional and part of options. We should allow passing schema or whatever is needed accordingly

## Q62. PoC (`unversioned-schema-version-typing/findings.md`): a plain `switch (event.schemaVersion)` narrows both branches only when a type declared with a version other than 1 requires `schemaVersion` on its values (the 4th parameter defaults to `number` for the bare `Event` and to `1` when the type name is a literal). Should a declared version other than 1 be required on the type, or stay optional so only `case 2` narrows? Asked for honest thoughts, the answer was: required, because an optional V2 version lets V2 data be stored as version 1 without a compile error, and the helper already requires it (criterion 2.1).

> What are your honest thoughts on that ?

> Sounds good, pleae record that in QA and Could you research also with the rest of types so we don't face this issue during implementation?

## Q63. The type surface research (`type-surface-research/findings.md`) found 88 new errors, all mechanical, and six points that need a decision (versioned command with `{ now }`, `CreateEventType`/`CreateCommandType`, two new exported type names, a downcast that leaves out the version, a union as the helper's type argument, `AnyRecordedMessage`). Go back to Q&A for them one at a time, or keep the suggested defaults?

> yes, go to qa

## Q64. A versioned command without declared metadata (`command<C2>(type, data, 2)`) cannot also take the default `{ now }` metadata. Should it, and if yes, in which position relative to the version?

> maybe we could make schema version be part of metadata? would it make it clearer and less weird (both for command and event). Thoughts?

## Q64 (thoughts). "Part of metadata" read two ways: (1) store it on the message as `metadata.schemaVersion` (pushed back: `tsc` shows a `switch` on `e.metadata?.schemaVersion` does not narrow the union, error TS2339, and it reverses Q4, Q17 and Q19), or (2) keep it top-level on the message, and pass it to the helpers through an object instead of a bare number. Which was meant?

> I just meant that this will be for factory methods, the other option is yes, just the schema version, no object
> continue

## Q65. Factory methods: (A) the version inside the metadata argument (`event<V2>(type, data, { schemaVersion: 2 })`, `command<C2>(type, data, { now, schemaVersion: 2 })`, the factory lifts it to the top level), or (B) a bare number as the last argument, with an extra command form `[type, data, metadata | undefined, version]`?

> I think A, thoughts?

## Q66. Put A into the spec with two rules: `schemaVersion` is a reserved key in the factory's metadata argument, and the factory lifts it to the top level and leaves out `metadata` when nothing else remains?

> So what would you recommend?

Recommendation given: A, with (1) the version inside the factory's metadata argument, required and containing `schemaVersion` for versioned types; (2) `schemaVersion` as a reserved key there, lifted to the top level by the factory, with no `metadata` key when nothing else remains; (3) for unversioned types and version 1 the argument stays as today and does not accept `schemaVersion`; checked with `tsc` before it goes into the spec.

> Yes, please do research and back to qa if any questions are left

Research result (`type-surface-research/factory-metadata-argument/findings.md`): the design from Q65 and Q66 adds 0 new errors across the repo, docs snippets, samples, `tsc -b`, and `tsdown` with attw. The helper types can stay unexported. The remaining open points are listed in spec "Open Questions".

## Q67. How should the factory treat `schemaVersion` in the metadata argument when (a) a variable that carries the key is passed for an unversioned type, and (b) a user metadata type declares its own `schemaVersion` (e.g. `schemaVersion?: string`)?

> Metadata should exclude their schema version and we should take the numeric message schema version, if possible, did you check it?

Checked so far: the typing part ("O1": `Omit<M, 'schemaVersion'>` plus `schemaVersion?: never` for unversioned types, or `schemaVersion: V` for versioned ones) compiles with 0 errors as a local signature, rejects the wide variable and the user string key, and makes a versioned type with a user `schemaVersion` key callable. Not yet checked: O1 in the real factories across the repo, union metadata types, and the runtime rule that lifts only numeric values. Research started for these.

Research result for Q67 ("O1 applied" in `type-surface-research/factory-metadata-argument/progress.md`): O1 in the real factories plus the numeric-only runtime lift adds 0 errors across packages, docs snippets, samples, `tsc -b`, and `tsdown` with attw. The runtime passes 21 checks: numbers lifted, `'2'` lifted as `2`, `'v2'`, `2.5`, `'2.0'` and `undefined` removed and not lifted. Plain `Omit` breaks 4 union-metadata calls that compile today (TS2353). A distributive `Omit` (`M extends unknown ? Omit<M, 'schemaVersion'> : never`) gives 0 errors.

## Q68. Accept the distributive `Omit` for the factory metadata argument, plus three consequences: a user metadata type with a required `schemaVersion` no longer matches the factory result; passing `schemaVersion` for an unversioned type fails with "number is not assignable to undefined"; the factory's numeric check reuses the read rule's `isNumericSchemaVersion`?

> I mean, it's just factory we can have the limit, if it doesn't work people can use regular creation. If this is such a big issue and confusing we can have as initially last param. You said that'd be beter to have it with metadata, now you show more and more isses.

## Q69. Go back to the bare last parameter (criteria 2.1 to 2.6 as written), with the limit that a versioned command without declared metadata cannot take `{ now }` through the factory?

> ok, then let's stick to that why no now?

## Q70. Should `command()` accept `{ now }` before the version for versioned commands without declared metadata, with two forms: `command<C2>(type, data, 2)` and `command<C2>(type, data, { now } | undefined, 2)`?

> yes, if we want to be explicit then let's be fully and not try to make shortcuts.

## Q71. "No shortcuts" read two ways for a versioned command without declared metadata: (1) both `command<C2>(type, data, 2)` and `command<C2>(type, data, { now }, 2)`, or (2) only the full form `command<C2>(type, data, undefined | { now }, 2)`. Events have no optional metadata, so they stay `event<V2>(type, data, 2)` and `event<V2m>(type, data, metadata, 2)`.

> will 1 work? if that works then fine, same for events if that's overcomplicating then just 2

Research result for Q71 (`type-surface-research/bare-number-with-command-metadata/findings.md`): option 1 works in the real factories. `command<C2>(type, data, 2)` and `command<C2>(type, data, { now } | undefined, 2)` both compile, and all wrong forms are rejected. Events keep their forms; `event<V2>(type, data, undefined, 2)` was not added, because events without declared metadata have no metadata position today. The runtime passes 22 checks. The change adds 0 new errors across the repo, docs snippets, samples, `tsc -b`, and `tsdown` with attw. The helper types stay unexported.

## Q72. Should `CreateEventType` and `CreateCommandType` get the same 4th type parameter and `schemaVersion` property as `Event` and `Command` (a `switch` over a union mixing them with versioned `Event` types fails today with TS2339), or stay as they are?

> yes

## Q73. Criterion 9.2 keeps the original version when a downcaster returns none, so a `(e: V2) => V1` downcaster that leaves out `schemaVersion` stores V1 data marked as version 2, and the types cannot force `schemaVersion: 1` because it is optional on V1. Keep 9.2, or change the behaviour?

> downcast should be able to provide also v1 & v2 compatible, but if we go this way, then maybe we could enforce here schemaVersion?

## Q74. Should upcast and downcast results always require `schemaVersion` (with 9.2's keep-the-original rule only as the runtime fallback for untyped code), or only downcast results? A standalone `tsc` check showed a downcast result type that requires the version compiles, accepts a V1-or-V2 downcast, and rejects V1 data marked as version 2.

> That could make sense, what do you think?

Recommendation given: enforce for both, but only when versions are in play. An upcast or downcast result must carry `schemaVersion` when the input type or the result type contains a declared version other than 1. Unversioned upcasters and downcasters are unchanged. 8.2 and 9.2 then hold only for unversioned types, plus as the runtime fallback for untyped code. Check in the real types across the repo first.

> Then check

Research result for Q74 (`type-surface-research/versioning-result-version/findings.md`): the rule works in the real types. Inline upcasters and downcasters still infer their parameter types everywhere. The upcasting docs examples compile unchanged. The full repo has 0 new errors after one mechanical SQLite fix, and the emitted JavaScript is byte-identical. Consequences: an identity upcaster from `V1 | V2` to `V1 | V2` is rejected in the payload form, and a downcaster annotated `(e: V2): V1` is rejected even when it returns `schemaVersion: 1`.

## Q75. Accept two consequences of requiring the version in versioned upcast and downcast results: (1) a downcaster annotated `(e: V2): V1` is rejected even when it returns `schemaVersion: 1`, so users drop the annotation (`1 as const`) or write `V1 & { readonly schemaVersion: 1 }`; (2) a pass-through upcaster from `V1 | V2` to `V1 | V2` is rejected in the payload form?

> I don't like the requirement to have const downcast = (e: V2) => ({ type: 'ProductItemAdded', data: {...}, schemaVersion: 1 as const }); // ok
> const downcast = (e: V2): V1 & { readonly schemaVersion: 1 } => ({ ... }); // ok
>
> What other options do we have?

## Q76. Options for upcast and downcast results without a version: (1) the result gets version `1` at runtime, matching the type, and 9.2 changes from "keeps 2" to "gets 1"; (2) keep the type rule that requires the version (annotation friction); (3) change nothing and document the pitfall. Asked which is the least surprise; answered (1), because the stored version then always matches the function's return type, and only untyped code returning `{ type, data }` from a versioned event can be surprised.

> what's the lease surprise?

> let's go with 1

## Q77. `event<V1 | V2>(type, data)` compiles without a version, because the V1 part makes it optional, so V2-shaped data passed this way is stored as version 1. Accept the limit (factories take a single message type, said in the docs), or make the factories reject union type arguments?

> yes

## Q78. `AnyRecordedMessage` is `Message<any, any, any>`, so its `schemaVersion` stays optional while `RecordedMessage` requires a number. It is used only for `lastSuccessfulMessage` in `typing/messageHandling.ts`. Leave it, or require `schemaVersion: number`?

> leave it as it is
