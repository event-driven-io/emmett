# Factory version inside the metadata argument: findings

The full log, with `tsc` output at file:line, is in `progress.md`, and the probe files are in `examples/`. This summary was saved by the main session, because the subagent could not write report files.

## Design checked (Q65, Q66)

The stored message is unchanged: `schemaVersion` stays at the top level, with the Dreq typing. Only the factories change:

- `event<V2>(type, data, { schemaVersion: 2 })`
- `event<V2m>(type, data, { ...metadata, schemaVersion: 2 })`
- `command<C2>(type, data, { now, schemaVersion: 2 })`
- `message<M2>(kind, type, data, { schemaVersion: 2 })`

The factory lifts `schemaVersion` to the top level. It leaves out `metadata` when nothing else remains. For unversioned types and version 1, the argument stays as today and does not accept `schemaVersion`.

## Results

- **Forms.** All agreed forms compile. All 16 rejected forms fail:
  - V2 without the argument (TS2554).
  - An argument without `schemaVersion` (TS2345).
  - A wrong literal (TS2322).
  - V2m without its declared metadata fields (TS2345).
  - Inline `schemaVersion` for V1, explicit `Event<..., 1>` or an unversioned command (TS2554, TS2353).
  - The old bare number (TS2345).
- **Return types.** `event<V2>(...)` is exactly `V2`, with no `metadata` key when none is declared. `event<V2m>(...)['metadata']` is the declared metadata, without `schemaVersion`.
- **Runtime split** (tsx in scratch, exit 0):
  - The version is lifted.
  - `metadata` is left out when empty, and kept when other keys remain.
  - Unversioned calls are unchanged.
  - `kind` is kept.
- **Full repo.** 0 new errors compared with the earlier research copy, across packages, docs snippets and samples. `tsc -b` exits 0, and `tsdown` with attw finds no problems. The one existing factory call with metadata compiles unchanged.
- **Helper types.** `SchemaVersionProperty`, `SchemaVersionArgument`, `MetadataArgument` and `liftSchemaVersion` can live in a module that is not re-exported. The bundled `.d.ts` stays valid. A consumer project emitting its own `.d.ts` against the bundle succeeds. Their names still show up in compiler error messages.
- **Generic callers.** These fail the same way as they do today. Forwarding `Parameters<typeof event<E>>` compiles.

## Fix needed in the earlier patches

`Dreq.diff` and `1-agreed-types.diff` contain a `>=` token after the `Message` type parameters, from `SchemaVersion extends number = ...` with no space before `=`. esbuild, and so tsx and likely vitest, fails on it: `message.ts:22:0: ERROR: Expected identifier but found ">="`. `tsc` and `tsdown` accept it. The fix is mechanical: write `> =`, as Prettier does. It is fixed in this folder's `all-changes.diff`.

## Open decisions

1. **An extra `schemaVersion` in a variable passed for an unversioned type.** It compiles, and the runtime lifts it, so a value typed `V1m` carries `schemaVersion: 2`. Option O1 forbids the key with `Omit<M, 'schemaVersion'> & { schemaVersion?: never }` for unversioned types (0 errors in `d2.edge-options.ts`). Its cost: the unversioned argument type is no longer exactly today's type, and `Omit` does not distribute over union metadata types.
2. **User metadata types that declare their own `schemaVersion`.**
   - For an unversioned type, it compiles and the user's string is lifted at runtime.
   - For a versioned type with a `string` key, the factory cannot be called (TS2322 to `never`).
   - The options are to accept this, to use O1, or to lift only numeric values at runtime (not tested).
3. **`{ now: undefined, schemaVersion: 2 }`** leaves `metadata: { now: undefined }`.
4. **`event<V1 | V2>(...)`** takes no argument and gives no version, the same as in the bare-number design.
5. **Helper placement.** Where the internal module lives, and whether `SchemaVersionProperty` moves there from `message.ts`.

## Final factory signatures

```ts
type SchemaVersionArgument<M extends Message> = { schemaVersion: MessageSchemaVersionOf<M> };
type MetadataArgument<M extends Message, MetaData> =
  undefined extends M['schemaVersion'] ? MetaData : MetaData & SchemaVersionArgument<M>;

export const event = <EventType extends Event<string, any, any, any>>(
  ...args: EventMetaDataOf<EventType> extends undefined
    ? undefined extends EventType['schemaVersion']
      ? [type: EventTypeOf<EventType>, data: EventDataOf<EventType>]
      : [type: EventTypeOf<EventType>, data: EventDataOf<EventType>, metadata: SchemaVersionArgument<EventType>]
    : [type: EventTypeOf<EventType>, data: EventDataOf<EventType>,
       metadata: MetadataArgument<EventType, EventMetaDataOf<EventType>>]
): EventType

export const command = <CommandType extends Command<string, any, any, any>>(
  ...args: CommandMetaDataOf<CommandType> extends undefined
    ? undefined extends CommandType['schemaVersion']
      ? [type, data, metadata?: DefaultCommandMetadata | undefined]
      : [type, data, metadata: Partial<DefaultCommandMetadata> & SchemaVersionArgument<CommandType>]
    : [type, data, metadata: MetadataArgument<CommandType, CommandMetaDataOf<CommandType>>]
): CommandType
```

`message` follows the same pattern, with `kind` first.
