# Typing `schemaVersion` on messages declared without a version

## Problem

If an unversioned type such as `Event<'ProductItemAdded', D1>` has `schemaVersion?: number`, a `switch` on `schemaVersion` cannot separate it from `V2`, because `number` includes `2`. If it has `schemaVersion?: 1`, the bare `Event` used as a constraint everywhere also gets `1`, so `V2` stops satisfying `T extends Event`.

## How this was checked

All results come from `tsc --noEmit --strict` (TypeScript 6.0.3, the repo's compiler). Each candidate is a small `examples/candidates/<name>/typing.ts` that copies the shape of the real `Event`, `Command`, `Message`, `AnyEvent`, `AnyCommand` and `AnyMessage`. It also has a simplified `RecordedMessage` (`MessageType & { readonly schemaVersion: number; ... }`), a simplified `upcastRecordedMessage` and an `event()` helper sketch.

`examples/checks.ts` must compile with 0 errors. Its sections:

- a: event narrowing in `case 2` and in `default`/`case 1`, with `@ts-expect-error`.
- b: V1 without `schemaVersion`, and with `schemaVersion: 1`.
- c: commands, `Message` unions and mixed unions.
- d: generic constraints with `Event`, `AnyEvent`, `Command`, `AnyCommand`, `Message` and `AnyMessage`.
- e: assignment to `Event`, `Message`, `AnyEvent`, `Event[]` and `Message[]`.
- f: recorded message narrowing, and `RecordedMessage['schemaVersion']` is `number`.
- g: `upcast: (e: V1 | V2) => V2` passed to `upcastRecordedMessage`.
- h: the helper requires a version for V2 and rejects one for V1.
- i: a `V1 | V2` handler where an `AnyEvent` handler is expected, as `ProjectionDefinition<AnyEvent>` does in the drivers.

`examples/observations.ts` only records behaviour (b3: V1 with `schemaVersion: 2`; b4: V2 without `schemaVersion`; b5: explicit `Event<..., 1>` without `schemaVersion`; e2/e3: V2 or V1 assigned to `Event<'ProductItemAdded'>`; e4: explicit `Event<..., 1>` equals no version; e5: `Event<string, D1>` keeps `number`; f2: `RecordedMessage<V1>['schemaVersion']` is `1`). `examples/usage.ts` is the upcaster a user would write. The tsc output for every file and candidate is in `examples/tsc-output/`.

The main session re-ran `checks.ts` plus `usage.ts` per candidate: A 25 errors, C 10, D 10, CreqA 0, Dreq 0. The subagent's counts (A 21, C 8) are for `checks.ts` alone.

## Impact surface

790 `.ts` files under `src/packages/*/src` were scanned, without `lib`, `node_modules` and `dist`.

- The bare constraint appears as `extends Event` 265 times in 36 files, `extends Message` 104 times in 37 files and `extends Command` 12 times in 4 files.
- Bare defaults: `= Event` 73 times in 28 files, `= Message` 25 times in 13 files, `= Command` once.
- `AnyEvent` appears 134 times in 23 files, `AnyMessage` 225 times in 40 files, `AnyCommand` 88 times in 15 files, and `Event[]` 34 times in 11 files.

A candidate must keep all of these working without edits.

## Candidates

### A: unversioned is `number`

```ts
readonly schemaVersion?: V extends number ? V : number;
```

Passes b, d, e, h and i. Fails a, c, f and g. `case 2` keeps V1: `error TS2322: Type 'V1 | V2' is not assignable to type 'V2'.` Real packages: 0 new errors.

### B: unversioned is `1`

```ts
readonly schemaVersion?: V extends number ? V : 1;
```

Fails a, c, d, e, f and g. The constraint breaks: `Argument of type 'V2' is not assignable to parameter of type 'Event'. ... Type '2 | undefined' is not assignable to type '1 | undefined'.`

### C: conditional on the type name, version optional

```ts
readonly schemaVersion?: V extends number ? V : string extends T ? number : 1;
```

`case 2` narrows to D2, so criterion 1.1 as written passes. The `default` and `case undefined: case 1:` branches still see `D1 | D2`, because `schemaVersion?: 2` also allows `undefined`: `Property 'productId' does not exist on type 'D1 | D2'.` V1 with `schemaVersion: 2` is rejected. V2 is not assignable to `Event<'ProductItemAdded'>`, because that type means version 1. Real packages: 0 new errors.

### D: fourth parameter default computed from the type name, version optional

```ts
SchemaVersion extends number = string extends EventType ? number : 1,
// ...
& { readonly schemaVersion?: SchemaVersion };
```

Same results as C. One difference: `Event<'X', D, undefined, 1>` is the same type as `Event<'X', D>`. D0 (default `= number`) behaves exactly like A. Real packages: 0 new errors.

### Creq: C, with a declared version required

```ts
type VersionProp<T extends string, V extends number | undefined> =
  V extends number
    ? { readonly schemaVersion: V }
    : { readonly schemaVersion?: string extends T ? number : 1 };
export type AnyEvent = Event<any, any, any, any>;
```

Passes a to h, fails i: `Type 'EventsHandler<V1 | V2>' is not assignable to type 'EventsHandler<AnyEvent>'. ... Type 'number | undefined' is not assignable to type '1 | undefined'.` On the real packages it gives 121 errors, almost all from `ProjectionDefinition<AnyEvent>` receiving a concrete projection.

### CreqA: Creq with `AnyEvent` and `AnyCommand` spelled out

```ts
export type AnyEvent = Event<any, any, any> & { readonly schemaVersion?: any };
export type AnyCommand = Command<any, any, any> & { readonly schemaVersion?: any };
```

Passes a to i. V1 with `schemaVersion: 2` and V2 without `schemaVersion` are rejected. Explicit `Event<..., 1>` requires `schemaVersion: 1` and is a different type from the unversioned one. Real packages: 0 new errors.

### Dreq: D, with a declared version other than 1 required

```ts
export type Event<
  EventType extends string = string,
  EventData extends DefaultRecord = DefaultRecord,
  EventMetaData extends DefaultRecord | undefined = undefined,
  SchemaVersion extends number = string extends EventType ? number : 1,
> = Readonly<...> & { readonly kind?: 'Event' } & VersionProp<EventType, SchemaVersion>;

type VersionProp<_T extends string, V extends number> = number extends V
  ? { readonly schemaVersion?: V }
  : V extends 1
    ? { readonly schemaVersion?: V }
    : { readonly schemaVersion: V };

export type AnyEvent = Event<any, any, any, any>;
```

`Command` and `Message` follow the same pattern. Passes a to i. `AnyEvent` gets `schemaVersion?: any` without special handling. V1 with `schemaVersion: 2` and V2 without `schemaVersion` are rejected. Explicit `Event<..., 1>` is the same type as no version, and the helper rejects a version argument for it. Real packages: 0 new errors. Patch: `examples/real-package-patches/Dreq.diff`.

### E: A plus a type guard (comparison only)

```ts
export const isSchemaVersion = <M extends AnyMessage, V extends number>(
  message: M,
  schemaVersion: V,
): message is Extract<M, { readonly schemaVersion?: V }> =>
  message.schemaVersion === schemaVersion;
```

The guard narrows both branches with 0 errors, but a plain `switch (event.schemaVersion)` fails as in A.

### G: no `schemaVersion` key on unversioned types

A `switch` on the union is not allowed: `Property 'schemaVersion' does not exist on type 'V1 | V2'.`

## Real packages

All packages and the docs snippets were copied to scratch and checked with `tsc -p tsconfig.eslint.json --noEmit`. The unmodified copy gives 3 errors, all in `docs/.vitepress/*.mts`, which are excluded. With only the message types changed, A, C, D, CreqA and Dreq give 0 new errors, Creq gives 121.

Making `RecordedMessage.schemaVersion` a required `number` adds 75 errors with any candidate (63 in emmett, 6 in emmett-postgresql, 2 in emmett-sqlite, 4 in emmett-esdb). Six are in non-test code that builds recorded messages: `inMemoryEventStore.ts`, `inMemoryProjectionSpec.ts`, `postgresProjectionSpec.ts`, `sqliteProjectionSpec.ts`, and both `readMessagesBatch.ts`. The rest are test fixtures. This is planned feature work (plan step 17), not a cost of the candidate.

Not tested on the real packages: the helper signature change, and removing `schemaVersion` from `CommonRecordedMessageMetadata`.

## Facts in short

Only CreqA and Dreq pass all checks with a plain `switch`. Both make a declared version (other than 1) required on values of that type, while the spec says `schemaVersion` is optional. In C and D the version stays optional and `case 2` narrows, but the `default` branch still sees both data shapes.

## What user code looks like

Under CreqA and Dreq (`examples/usage.ts`, 0 errors with both):

```ts
type ProductItemAddedV1 = Event<'ProductItemAdded', { productId: string }>;
type ProductItemAddedV2 = Event<'ProductItemAdded', { productItem: ProductItem }, undefined, 2>;

const upcast = (event: ProductItemAddedV1 | ProductItemAddedV2): ProductItemAddedV2 => {
  switch (event.schemaVersion) {
    case 2:
      return event;
    default:
      return {
        type: 'ProductItemAdded',
        data: { productItem: { productId: event.data.productId, quantity: 1 } },
        schemaVersion: 2,
      };
  }
};

const v1: ProductItemAddedV1 = { type: 'ProductItemAdded', data: { productId: 'p' } };
const v2 = event<ProductItemAddedV2>('ProductItemAdded', { productItem }, 2);
```

Under C and D the same upcaster fails in `default` with `Property 'productId' does not exist on type '{ productId: string; } | { productItem: ProductItem; }'`.

Under E:

```ts
const upcast = (event: ProductItemAddedV1 | ProductItemAddedV2): ProductItemAddedV2 =>
  isSchemaVersion(event, 2)
    ? event
    : { type: 'ProductItemAdded', data: { productItem: { productId: event.data.productId, quantity: 1 } }, schemaVersion: 2 };
```
