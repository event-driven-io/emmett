import {
  DeciderSpecification,
  eventsInStream,
  type InMemoryProjectionSpec,
} from '@event-driven-io/emmett';
import {
  existingStream,
  expectNewEvents,
  type ApiSpecification,
} from '@event-driven-io/emmett-expressjs';
import type { ApiSpecification as HonoApiSpecification } from '@event-driven-io/emmett-honojs';
import type { MongoDBInlineProjectionSpec } from '@event-driven-io/emmett-mongodb';
import {
  eventsInStream as pgEventsInStream,
  type PostgreSQLProjectionSpec,
} from '@event-driven-io/emmett-postgresql';
import type { SQLiteProjectionSpec } from '@event-driven-io/emmett-sqlite';
import { v1, v2, type C2, type Stored, type V2 } from './domain';

const productItem = { productId: 'p', quantity: 1 };
const v2NoVersion = { type: 'ProductItemAdded' as const, data: { productItem } };

// e1: DeciderSpecification with a versioned event type
const given = DeciderSpecification.for<C2, V2, { n: number }>({
  decide: () => v2,
  evolve: (s) => s,
  initialState: () => ({ n: 0 }),
});
export const e1 = () => {
  given([v2]).when({ type: 'AddProductItem', data: { productItem }, schemaVersion: 2 }).then([v2]);
  // @ts-expect-error expected V2 without schemaVersion
  given([]).when({ type: 'AddProductItem', data: { productItem }, schemaVersion: 2 }).then([v2NoVersion]);
  // @ts-expect-error given V2 without schemaVersion
  given([v2NoVersion]);
  // @ts-expect-error command C2 without schemaVersion
  given([]).when({ type: 'AddProductItem', data: { productItem } });
};

// e2: projection specs over the stored union
declare const inMemory: InMemoryProjectionSpec<Stored>;
declare const pg: PostgreSQLProjectionSpec<Stored>;
declare const sqlite: SQLiteProjectionSpec<Stored>;
declare const mongo: MongoDBInlineProjectionSpec<`cart:${string}`, Stored>;
export const e2 = () => {
  inMemory([v1, v2]).when([v2]);
  pg([v1]).when(pgEventsInStream('s', [v1, v2]));
  sqlite([]).when([v1, v2]);
  mongo({ streamName: 'cart:1', events: [v1, v2] }).when([v2]);
  inMemory(eventsInStream('s', [v1, v2])).when([]);
  // @ts-expect-error V2 without schemaVersion in a projection spec
  inMemory([v2NoVersion]);
  // @ts-expect-error V2 without schemaVersion in a projection spec
  pg([]).when([v2NoVersion]);
};

// e3: API specifications
declare const api: ApiSpecification<Stored>;
declare const honoApi: HonoApiSpecification<Stored>;
export const e3 = async () => {
  await api(existingStream('s', [v1, v2]))
    .when((r) => r.post('/x'))
    .then([expectNewEvents('s', [v2])]);
  await api()
    .when((r) => r.post('/x'))
    // @ts-expect-error expected V2 without schemaVersion
    .then([expectNewEvents<Stored>('s', [v2NoVersion])]);
  void honoApi;
};
