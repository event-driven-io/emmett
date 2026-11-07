# Bare-number factories with the command metadata form: findings

The full log, with `tsc` output at file:line, is in `progress.md`. The probe files are in `examples/`. This summary was saved by the main session.

## Design checked (Q69 to Q71)

The factories take the version as a bare last number. A versioned command without declared metadata accepts both forms:

- `command<C2>(type, data, 2)`
- `command<C2>(type, data, { now } | undefined, 2)`

Events keep `event<V2>(type, data, 2)` and `event<V2m>(type, data, metadata, 2)`. Metadata is not touched.

## Results

- **Accepted forms** (`a.forms.ts`, 0 errors, all 21 `@ts-expect-error` lines used):
  - Versioned commands: `command<C2>(t, d, 2)`, `command<C2>(t, d, { now }, 2)`, `command<C2>(t, d, undefined, 2)`, `command<C2>(t, d, maybeNow, 2)`, `command<C3>(t, d, { now }, 3)` and `command<C2m>(t, d, metadata, 2)`.
  - Unversioned commands, exactly as today.
  - Events and `message()`, in their existing forms.
  - The return types are exactly the declared types.
- **Rejected forms:**
  - no version;
  - `{ now }` without a version;
  - the version before `{ now }`;
  - a wrong literal;
  - `undefined` without a version;
  - `C2m` without its version, with `undefined` as metadata, or without its metadata;
  - a version on an unversioned command;
  - metadata other than `{ now }`.
- **The `event<V2>(type, data, undefined, 2)` form** was not added. Events without declared metadata have no metadata position today (`event<E1>('A', d, undefined)` fails with TS2554), so it would be a new form with no unversioned counterpart.
- **Runtime** (`tsx c.runtime.ts`, exit 0, 22 checks pass):
  - `(t, d, 2)` and `(t, d, undefined, 2)` give `schemaVersion: 2` and no `metadata` key.
  - `(t, d, { now }, 2)` gives both `metadata` and `schemaVersion`.
  - Unversioned calls are unchanged.
- **Full repo.** 0 new errors compared with the first research copy, across packages, docs snippets and samples. `tsc -b` exits 0, and `tsdown` with attw finds no problems.
- **Helper types.** `SchemaVersionProperty`, `WithSchemaVersionArgument` and `splitMetadataAndSchemaVersion` are not reachable from the package, and the consumer `.d.ts` emit succeeds. `MessageSchemaVersionOf` is exported.
- **Patch.** `all-changes.diff` (29 package files plus the durable-objects sample fix) applies to the current repo, and has no `>=` token. It is not formatted with Prettier.

## Fact to weigh

A wrong call on a versioned command without declared metadata gets a longer TS2345 error that lists both tuple forms, instead of "Expected N arguments".

## Final code

```ts
// messageSchemaVersion.ts (not re-exported)
export type WithSchemaVersionArgument<MessageType extends Message, Args extends unknown[]> =
  undefined extends MessageType['schemaVersion']
    ? Args
    : [...Args, schemaVersion: MessageSchemaVersionOf<MessageType>];

export const splitMetadataAndSchemaVersion = (
  optionalArguments: unknown[],
): { metadata?: unknown; schemaVersion?: number } => {
  const last = optionalArguments[optionalArguments.length - 1];
  const schemaVersion = typeof last === 'number' ? last : undefined;
  const metadata =
    schemaVersion !== undefined && optionalArguments.length === 1 ? undefined : optionalArguments[0];
  return {
    ...(metadata !== undefined ? { metadata } : {}),
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
  };
};

// command.ts
export const command = <CommandType extends Command<string, any, any, any>>(
  ...args: CommandMetaDataOf<CommandType> extends undefined
    ? undefined extends CommandType['schemaVersion']
      ? [type: CommandTypeOf<CommandType>, data: CommandDataOf<CommandType>,
         metadata?: DefaultCommandMetadata | undefined]
      :
          | WithSchemaVersionArgument<CommandType,
              [type: CommandTypeOf<CommandType>, data: CommandDataOf<CommandType>]>
          | WithSchemaVersionArgument<CommandType,
              [type: CommandTypeOf<CommandType>, data: CommandDataOf<CommandType>,
               metadata: DefaultCommandMetadata | undefined]>
    : WithSchemaVersionArgument<CommandType,
        [type: CommandTypeOf<CommandType>, data: CommandDataOf<CommandType>,
         metadata: CommandMetaDataOf<CommandType>]>
): CommandType => {
  const [type, data, ...optionalArguments] = args;
  return { type, data, kind: 'Command', ...splitMetadataAndSchemaVersion(optionalArguments) } as CommandType;
};

// event.ts
export const event = <EventType extends Event<string, any, any, any>>(
  ...args: EventMetaDataOf<EventType> extends undefined
    ? WithSchemaVersionArgument<EventType, [type: EventTypeOf<EventType>, data: EventDataOf<EventType>]>
    : WithSchemaVersionArgument<EventType,
        [type: EventTypeOf<EventType>, data: EventDataOf<EventType>, metadata: EventMetaDataOf<EventType>]>
): EventType => {
  const [type, data, ...optionalArguments] = args;
  return { type, data, kind: 'Event', ...splitMetadataAndSchemaVersion(optionalArguments) } as EventType;
};

// message.ts: the same tuples with `kind` first
```
