# Cloudflare samples port brainstorm

## Question 1

Should this port cover both Cloudflare samples (`d1` and `durable-objects`), or only the Durable Objects sample currently open in your IDE?

## Answer 1

Both samples.

## Question 2

For preserving the concurrent `/current` behavior safely, should each client have one event stream containing its successive cart generations (simpler and recommended), or should each cart have its own stream plus a separate concurrency-safe registry that tracks the client’s current cart?

## Answer 2

Keep each shopping cart in a separate event stream and use an inline projection that stores only the pointer to the client's active cart stream.

## Question 3

When you say “use the shopping cart flow,” should we adapt the existing event-sourced flow from `samples/webApi/honojs-with-postgresql/src/shoppingCarts`, or event-source the copied Cloudflare domain as-is so every current behavior (including UUID carts, separate Confirmed/Cancelled states, and idempotent close operations) remains unchanged?

## Answer 3

Use the existing event-sourced Hono/PostgreSQL shopping-cart flow more or less as the starting point, with the previously specified adjustment: keep carts in separate streams and maintain an inline-projected pointer to the active stream. Adapt it so the existing Cloudflare API specifications and behavior remain unchanged unless explicitly agreed otherwise.

## Question 4

Should Pongo maintain two inline read models: (1) the existing full `shoppingCarts` documents used by GETs and response bodies, and (2) a small client-keyed active-cart pointer, or should the existing `Opened` cart document and its unique index serve as the pointer without adding another collection?

## Answer 4

Yes. This answer is ambiguous because the question offered two alternatives, so a follow-up confirmation is required.

## Question 5

Do you mean that Pongo should have two inline read models: the full `shoppingCarts` projection and a separate client-keyed active-cart pointer projection?

## Answer 5

Yes. Use both inline Pongo read models.

## Question 6

Should the ported samples use published npm packages (bumped to the version that has the `emmett-sqlite/cloudflare` drivers), or local workspace packages?

## Answer 6

Use published npm packages. The first step is to bump all Emmett packages in both samples to `0.43.0-beta.48`.

## Question 7

How should the port stop two concurrent "add to current cart" requests from opening two carts: (1) the inline pointer projection fails the append transaction on conflict, or (2) a deterministic cart ID per client generation (for example `${clientId}:${n}`), so both requests append to the same stream and the expected-version check catches the race?

## Answer 7

Option 2: deterministic cart ID per client generation. This changes the cart ID format from a UUID.

## Question 8

Where should the port get `n` (the client's cart generation): (1) from the inline pointer read model `{ clientId, currentGeneration, activeShoppingCartId | null }`, or (2) from a separate per-client counter stream that records `ShoppingCartGenerationStarted`?

## Answer 8

Option 2 is attractive as a "client active stream", but Emmett has no atomic multi-stream appends, so option 1 is probably the choice. A follow-up confirmation is required.

## Question 9

Do you confirm option 1: the pointer read model `{ clientId, currentGeneration, activeShoppingCartId | null }`, updated inline in the append transaction, with next cart ID `${clientId}:${currentGeneration + 1}`?

## Answer 9

Confirmed. Do not invent the "generation" term; use a plain name such as `currentNumber` or `currentActive`.

## Question 10

Should the pointer read model be `ClientShoppingCarts { clientId, lastCartNumber (0 before the first cart), activeShoppingCartId | null }`, with the next cart ID `${clientId}:${lastCartNumber + 1}`?

## Answer 10

Yes.

## Question 11

Should the port add an explicit `ShoppingCartOpened { shoppingCartId, clientId, openedAt }` event, appended together with the first `ProductItemAddedToShoppingCart` in one append to the new stream?

## Answer 11

Yes, add `ShoppingCartOpened` and use it as the transition event for the pointer. The pointer may also need a status (for example, to know that the previous cart was closed), or the flow must automatically open a new cart. A follow-up is required.

## Question 12

Is `activeShoppingCartId: null` enough to show that the client has no open cart, or should the pointer also have an explicit `status`?

## Answer 12

Do not use `null`. Keep `lastShoppingCartId` together with a status.

## Question 13

Which values should the pointer `status` have: `'Opened' | 'Closed'`, or `'Opened' | 'Confirmed' | 'Cancelled'`?

## Answer 13

`'Opened' | 'Closed'`.

## Question 14

For the write model, should the port replace Hono's `Closed` with `Confirmed` and `Cancelled`, so that a repeated `confirm`/`cancel` returns no events (unchanged stream version and ETag) and closing with the other command returns 409? Or should the API layer handle the retry?

## Answer 14

The idempotency check belongs in the business logic, not the API layer. Use `Confirmed` and `Cancelled` in the write model.

## Question 15

How should `GET` get the stream version for the ETag: (1) the full read model stores `streamVersion` from `event.metadata.streamPosition`, (2) `GET` reads the stream for the version and the read model for the body, or (3) `GET` builds the response from `aggregateStream`?

## Answer 15

Check how the other samples handle it. `GET` can take the version from the read model, which keeps the stream position of the active stream. A follow-up is required to confirm which read model keeps it.

Findings from the other samples: the Hono, Express, and SQLite web API samples do not return ETags from `GET`. Their command endpoints return `204 No Content`, and `GET` removes `_version` from the body. No sample outside `samples/cloudflare` uses `toWeakETag` or `getETagValueFromIfMatch`.

## Question 16

Which read model keeps the stream position: each full `shoppingCarts` document (covers `GET .../current` and `GET .../:shoppingCartId`), or only the pointer?

## Answer 16

The read model that `GET` queries keeps the stream version. Each full `shoppingCarts` document keeps the stream position of its own cart stream.

## Question 17

How should `GET .../current` find the cart: (1) query `shoppingCarts` with `{ clientId, status: 'Opened' }`, or (2) read the pointer, then load the cart by `lastShoppingCartId`?

## Answer 17

Option 1. The pointer is used only by the command side.

## Question 18

For the Durable Objects sample: (1) keep the `ShoppingCartDurableObject` class and its RPC methods, and replace the Pongo collection inside with an Emmett SQLite event store (`durableObjectEventStoreDriver`, both inline projections, `handleCommand`, migration in `blockConcurrencyWhile`), or (2) move the logic into module functions with a thin class wrapper?

## Answer 18

Option 1.

## Question 19

Should the port remove the `shopping_carts_one_open_per_client` unique index and the custom `pongo.config.ts` schema, or keep the index as an extra safety net?

## Answer 19

The event store owns schema management. But projections must stay strongly typed with a schema, and querying still needs a schema.

## Question 20

Is this design correct: `pongo.config.ts` stays with typed `shoppingCarts` and `clientShoppingCarts` collections (no unique index), projections take `collectionName` from that schema, the read-side `pongoClient` uses the schema with `autoMigration: 'None'`, and only `eventStore.schema.migrate()` changes tables? Optionally, add a non-unique `{ clientId, status }` index.

## Answer 20

Yes, the design is correct. The index question was not answered.

## Question 21

Should `shoppingCarts` get a non-unique index on `{ clientId, status }` for `GET .../current`?

## Answer 21

Yes. The read models need indexes, because the queries do not work on D1 without them.

## Question 22

How should the read model indexes get created: (1) an `onAfterSchemaCreated` hook that runs `pongoDb.schema.migrate()`, (2) change `emmett-sqlite` so Pongo projections accept a `pongoSchema` collection definition, or (3) call both migrations one after the other?

## Answer 22

Define the indexes on the Pongo schema. Pass the schema through the projection collection options, so the event store migration sets them up. Run the migration the same way as the Pongo samples do now (the D1 `/_system/migrations` endpoint and `blockConcurrencyWhile` in the Durable Object).

Finding: in the current code, the collection options cannot carry the schema. `PongoDBCollectionOptions` in Pongo `0.17.0-beta.55` has only `databaseSchemaName`, `schema.versioning`, `errors`, and `cache`. Indexes exist only on `pongoSchema.collection(name, { indexes })`. The `emmett-sqlite` Pongo projections create their Pongo client without a schema definition. A follow-up is required.

## Question 23

Where should the change that lets projections create indexes go: (1) only in `emmett-sqlite` (projections accept a `pongoSchema.collection(...)` component), or (2) in Pongo first (`PongoDBCollectionOptions` gets a collection definition that `collection.schema.migrate()` uses), then in `emmett-sqlite`?

## Answer 23

Option 2. `PongoMultiStreamProjectionOptions` already has `collectionOptions`; the missing part is the collection definition. Fix Pongo first, then Emmett.

## Question 24

Should `spec.md` cover all three phases in detail (Pongo API, `emmett-sqlite` pass-through, samples), or only Emmett and the samples with the Pongo change as a prerequisite?

## Answer 24

Cover all three phases in detail in `spec.md`.

## Question 25

Which Pongo API shape: (1) a new option `db.collection<T>(name, { definition: collectionComponent })` that registers `definition` in place of the bare collection when the name is not declared yet, or (2) an overload `db.collection(collectionComponent, options)`?

## Answer 25

Option 1.

## Question 26

What should `db.collection(name, { definition })` do in edge cases (definition name differs from `name`, collection already declared with the same or a different component)?

## Answer 26

No edge-case rules. Pongo already accepts schema definitions at the client and database level; the only missing part is the `collection()` helper. When `definition` is passed, `collection()` uses it.

## Question 27

How should the port change the sample tests: (1) keep `api.int.spec.ts` and `api.e2e.spec.ts` as acceptance tests (changed only where agreed changes require it), rewrite `businessLogic.unit.spec.ts` with `DeciderSpecification`, and add projection unit tests, or (2) rewrite all tests in the Hono/PostgreSQL sample style?

## Answer 27

Option 1. Option 2 made no sense: both Cloudflare API specs already use `ApiE2ESpecification` from `@event-driven-io/emmett-honojs`.

Addition from Oskar (given with Answer 28): the integration tests can use `ApiSpecification` with given events, as the PostgreSQL samples do.

## Question 28

How should the port change both READMEs: (1) rewrite the design parts and keep the setup, run, test, and deploy sections with updated names and commands, (2) change only names and commands and add a short design section, or (3) defer to a separate issue?

## Answer 28

Option 1.

## Question 29

How should the cart ID look: (1) `${clientId}:${n}` in the body and URL, with stream name `shopping_cart-${clientId}:${n}`, or (2) only `${n}` in the body and URL, with the same stream name?

## Answer 29

Option 1.

## Question 30

Should the samples phase start with a bump to the Emmett release from the Emmett phase (not `beta.48`), and is anything missing from the phase list (Pongo, then Emmett, then samples)?

## Answer 30

Do all possible sample work first, on `0.43.0-beta.48`. Start the Pongo and Emmett fixes in parallel. Bump the samples to the new releases only when Oskar says that they are ready.

## Correction after the spec

The `shoppingCarts` single-stream projection uses the stream ID as the document ID (the default `getDocumentId`), not `shoppingCartId`.

## Question 31

Which ID should the API show: (1) the cart ID `c1:3` in the URL and body, with a separate `shoppingCartId` field and `_id` = stream name, or (2) the stream name `shopping_cart-c1:3` everywhere, so the cart ID is the stream name and `shoppingCartUrl` stays as it is?

## Answer 31

Option 2. This replaces Answer 29: the cart ID is the stream name `shopping_cart-${clientId}:${n}` in the document `_id`, the body, and the URL.
