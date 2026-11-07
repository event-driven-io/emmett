# Required version in upcast and downcast results: findings

The full log, with `tsc` output at file:line, is in `progress.md`. The probe files are in `examples/`. This summary was saved by the main session.

## Rule checked (Q74)

An upcast or downcast result must carry `schemaVersion` when the input type or the result type contains a declared version other than 1. When both sides are unversioned, nothing changes.

## What changed

- The module-local `typing/messageSchemaVersion.ts` (not re-exported) gets `VersioningResult` and two private helpers.
- `VersioningResult` becomes the return type of every payload-form upcast and downcast function type:
  - `MessageUpcast` and `MessageDowncast`;
  - `EventStoreReadSchemaOptions` and `EventStoreAppendSchemaOptions`, used by readStream, appendToStream, aggregateStream, projection `eventsOptions` and every driver;
  - `CommandHandlerOptions.schema.versioning`;
  - `ReactorOptions.messageOptions.schema.versioning`;
  - `WorkflowOptions.schema.versioning`.
- The recorded form is unchanged. It already enforced the rule, because `RecordedMessage<V1>['schemaVersion']` is `1`.
- `JSONCodec` is unchanged, because its types are not limited to messages.

## Evidence

- **Standalone cases** (`a.standalone.ts`, 0 errors, all 19 `@ts-expect-error` lines used).
  - Newly rejected:
    - `MessageDowncast<V2, V1>` without a version;
    - `MessageDowncast<V2, V1 | V2>` without a version;
    - an upcast to `V1 | V2` with a V1 member without a version;
    - an identity payload upcaster from `V1 | V2` to `V1 | V2`.
  - Rejected before and after: V1 data with version 2, V2 results without a version, and the recorded-form cases.
  - Accepted: `schemaVersion: 1` for V1 results, `2` for V2 results, and every unversioned case.
- **Inference** (`b.inference.ts`, 0 errors, no implicit any). Inline `(e) => ...` functions still infer their parameter types in `CommandHandler`, `reactor`, `readStream`, `appendToStream`, `aggregateStream`, `WorkflowOptions`, projection `eventsOptions`, and an unversioned `CommandHandler`.
- **Full repo.** 1 new error compared with the previous copy. It was mechanical, in `emmett-sqlite/src/eventStore/schema/appendToStream.ts(108,13)` TS2345: `options` was typed with the default `Event` generics behind a cast in `SQLiteEventStore.ts`. The fix adds a second generic `MessagePayloadType`, as PostgreSQL already does. After it, there are 0 new errors.
  - The upcasting docs examples (`commandhandler.md:228` and `:232`, `projections.md:168`) compile unchanged.
  - The samples have the same errors as before.
  - `tsc -b` exits 0, and `tsdown` with attw finds no problems.
- **Helper types** stay module-local in the bundled `.d.ts`, and the consumer `.d.ts` emit succeeds.
- **Runtime.** The emitted JavaScript of all 9 changed files is byte-identical to the previous copy. The keep-the-original fallback stays.
- **Patch.** `all-changes.diff` (35 files) applies to the current repo, checked by the main session too.

## Consequences to decide on

1. **Identity upcaster on a mixed union.** An upcaster from `V1 | V2` to `V1 | V2` that returns its input unchanged is rejected in the payload form, because a V1 input may have no version. The recorded form accepts it.
2. **Return-type annotations.** A downcaster annotated `(e: V2): V1` is rejected even when it returns `schemaVersion: 1`. Users drop the annotation, or write `V1 & { readonly schemaVersion: 1 }`.
3. **Criteria 8.2 and 9.2.** The keep-the-original rule then holds at the type level only for unversioned types. At runtime it stays as the fallback for untyped code.
4. **`JSONCodec`** is unchanged.

## Final type definitions

```ts
// typing/messageSchemaVersion.ts (not re-exported)
type DeclaresSchemaVersion<MessageType> = MessageType extends Message
  ? undefined extends MessageType['schemaVersion'] ? false : true
  : false;

type WithRequiredSchemaVersion<MessageType extends Message> = MessageType extends Message
  ? MessageType & { readonly schemaVersion: MessageSchemaVersionOf<MessageType> }
  : never;

export type VersioningResult<Input extends Message, Output extends Message> =
  true extends DeclaresSchemaVersion<Input> | DeclaresSchemaVersion<Output>
    ? WithRequiredSchemaVersion<Output>
    : Output;

// MessageUpcast payload form:   (message: MessagePayloadType) => VersioningResult<MessagePayloadType, MessageType>
// MessageDowncast payload form: (message: MessageType) => VersioningResult<MessageType, MessagePayloadType>
// eventStore.ts, handleCommand.ts, workflowProcessor.ts, processors.ts:
//   upcast?: (event: EventPayloadType) => VersioningResult<EventPayloadType, StreamEvent>;
//   downcast?: (event: StreamEvent) => VersioningResult<StreamEvent, EventPayloadType>;
```
