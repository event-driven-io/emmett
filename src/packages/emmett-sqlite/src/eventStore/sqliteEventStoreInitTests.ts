import {
  InvalidOperationError,
  PendingMigrationsError,
  SQL,
  type SQLExecutor,
} from '@event-driven-io/dumbo';
import { tableExists } from '@event-driven-io/dumbo/sqlite';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertThrowsAsync,
  assertTrue,
  projections,
  type ProjectionHandlingType,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { describe, it } from 'vitest';
import type { ProductItemAdded } from '../testing/shoppingCart.domain';
import { pongoSingleStreamProjection } from './projections/pongo/pongoProjections';
import { sqliteProjection } from './projections/sqliteProjection';
import type {
  SQLiteEventStore,
  SQLiteEventStoreOptions,
} from './SQLiteEventStore';

export type SQLiteEventStoreInitTestStoreOptions = Pick<
  SQLiteEventStoreOptions,
  'schema' | 'projections' | 'hooks'
> & { allowNestedTransactions?: boolean };

export type SQLiteEventStoreInitTestsOptions = {
  storeWith: (
    options: SQLiteEventStoreInitTestStoreOptions,
  ) => SQLiteEventStore;
  execute: () => SQLExecutor;
  rollsBackTransactions: boolean;
};

const withDeadline = { timeout: 30000 };

const migrationTableName = 'emmett_migrations';
const storeSchema = { migrationTable: { tableName: migrationTableName } };

export const sqliteEventStoreInitTests = ({
  storeWith,
  execute,
  rollsBackTransactions,
}: SQLiteEventStoreInitTestsOptions) => {
  const append = (store: Pick<SQLiteEventStore, 'appendToStream'>) =>
    store.appendToStream<ProductItemAdded>(`shopping_cart-${uuid()}`, [
      {
        type: 'ProductItemAdded',
        data: { productItem: { productId: '123', quantity: 10, price: 3 } },
      },
    ]);

  const countingProjection = (
    name: string,
    initCalls: ProjectionHandlingType[],
  ) =>
    sqliteProjection<ProductItemAdded>({
      name,
      canHandle: ['ProductItemAdded'],
      handle: () => Promise.resolve(),
      init: ({ registrationType }) => {
        initCalls.push(registrationType);
      },
    });

  const exists = (tableName: string) => tableExists(execute(), tableName);

  const dropMigrationTable = () =>
    execute().command(SQL`DROP TABLE ${SQL.identifier(migrationTableName)}`);

  void it(
    'migrates the event store and the inline and async Pongo collections in one call under None',
    withDeadline,
    async () => {
      const store = storeWith({
        schema: { autoMigration: 'None', ...storeSchema },
        projections: [
          ...projections.inline([shoppingCartSummary('inline_summary')]),
          ...projections.async([shoppingCartSummary('async_summary')]),
        ],
      });

      try {
        await store.schema.migrate();

        assertTrue(await exists('emt_streams'));
        assertTrue(await exists('inline_summary'));
        assertTrue(await exists('async_summary'));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'describes the event store and then the projections in registration order',
    withDeadline,
    async () => {
      const store = storeWith({
        schema: storeSchema,
        projections: [
          ...projections.async([shoppingCartSummary('async_summary')]),
          ...projections.inline([shoppingCartSummary('inline_summary')]),
        ],
      });

      try {
        const sql = store.schema.sql();

        assertTrue(sql.indexOf('emt_streams') >= 0);
        assertTrue(sql.indexOf('emt_streams') < sql.indexOf('async_summary'));
        assertTrue(
          sql.indexOf('async_summary') < sql.indexOf('inline_summary'),
        );

        const componentMigrations = store.schema.component
          .migrations()
          .map(({ name }) => name);
        assertTrue(
          componentMigrations.some((name) => name.includes('async_summary')),
        );
        assertTrue(
          componentMigrations.some((name) => name.includes('inline_summary')),
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'reports pending migrations on a fresh database and passes after migrate',
    withDeadline,
    async () => {
      const store = storeWith({ schema: storeSchema });

      try {
        await assertThrowsAsync(
          () => store.schema.ensureMigrated(),
          (error) => error instanceof PendingMigrationsError,
        );

        await store.schema.migrate();

        await store.schema.ensureMigrated();
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'reads no migration history under None and initializes the inline projections',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      const migrated = storeWith({ schema: storeSchema });
      const store = storeWith({
        schema: { autoMigration: 'None', ...storeSchema },
        projections: projections.inline([
          countingProjection('inline_projection', initCalls),
        ]),
      });

      try {
        await migrated.schema.migrate();
        await dropMigrationTable();

        await append(store);

        assertFalse(await exists(migrationTableName));
        assertDeepEqual(initCalls, ['inline']);
      } finally {
        await migrated.close();
        await store.close();
      }
    },
  );

  void it(
    'does not initialize the inline projections in migrate',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      const store = storeWith({
        schema: storeSchema,
        projections: projections.inline([
          countingProjection('inline_projection', initCalls),
        ]),
      });

      try {
        await store.schema.migrate();

        assertDeepEqual(initCalls, []);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'initializes each inline projection once as inline',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      const store = storeWith({
        schema: storeSchema,
        projections: projections.inline([
          countingProjection('first_projection', initCalls),
          countingProjection('second_projection', initCalls),
        ]),
      });

      try {
        await store.init();
        await store.init();

        assertDeepEqual(initCalls, ['inline', 'inline']);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'initializes inline projections outside a transaction, so their own transactions are not nested',
    withDeadline,
    async () => {
      const store = storeWith({
        allowNestedTransactions: false,
        schema: storeSchema,
        projections: projections.inline([
          sqliteProjection<ProductItemAdded>({
            name: 'transactional_init',
            canHandle: ['ProductItemAdded'],
            handle: () => Promise.resolve(),
            init: ({ context }) =>
              context.session.connection.withTransaction(() =>
                Promise.resolve(),
              ),
          }),
        ]),
      });

      try {
        await store.init();
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'initializes on the first operation when nobody called init',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      const store = storeWith({
        schema: storeSchema,
        projections: projections.inline([
          countingProjection('inline_projection', initCalls),
        ]),
      });

      try {
        await append(store);
        await append(store);

        assertDeepEqual(initCalls, ['inline']);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'does not initialize again on the first operation after init',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      const store = storeWith({
        schema: storeSchema,
        projections: projections.inline([
          countingProjection('inline_projection', initCalls),
        ]),
      });

      try {
        await store.init();
        await append(store);

        assertDeepEqual(initCalls, ['inline']);
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'throws pending migrations from init under EnsureMigrated on a fresh database',
    withDeadline,
    async () => {
      const store = storeWith({
        schema: { autoMigration: 'EnsureMigrated', ...storeSchema },
      });

      try {
        await assertThrowsAsync(
          () => store.init(),
          (error) => error instanceof PendingMigrationsError,
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'runs the schema hooks once per instance also when nothing is pending',
    withDeadline,
    async () => {
      let hookCalls = 0;
      const migrated = storeWith({ schema: storeSchema });
      const store = storeWith({
        schema: storeSchema,
        hooks: {
          onBeforeSchemaCreated: () => {
            hookCalls++;
          },
          onAfterSchemaCreated: () => {
            hookCalls++;
          },
        },
      });

      try {
        await migrated.schema.migrate();

        await store.init();
        await append(store);
        await store.schema.migrate();

        assertEqual(hookCalls, 2);
      } finally {
        await migrated.close();
        await store.close();
      }
    },
  );

  if (rollsBackTransactions) {
    void it(
      'runs the schema hooks in the migration transaction',
      withDeadline,
      async () => {
        const store = storeWith({
          schema: storeSchema,
          hooks: {
            onAfterSchemaCreated: () => {
              throw new Error('hook failed');
            },
          },
        });

        try {
          await assertThrowsAsync(() => store.schema.migrate());

          assertFalse(await exists('emt_streams'));
          assertFalse(await exists(migrationTableName));
        } finally {
          await store.close();
        }
      },
    );

    void it(
      'rolls back a dry run and does not count it as migrated',
      withDeadline,
      async () => {
        const store = storeWith({
          schema: { autoMigration: 'EnsureMigrated', ...storeSchema },
        });

        try {
          const dryRun = await store.schema.migrate({
            dryRun: 'transactional',
          });

          assertTrue(dryRun.applied.length > 0);
          assertFalse(await exists(migrationTableName));
          await assertThrowsAsync(
            () => store.init(),
            (error) => error instanceof PendingMigrationsError,
          );
        } finally {
          await store.close();
        }
      },
    );
  } else {
    void it(
      'rejects a transactional dry run before running the schema hooks',
      withDeadline,
      async () => {
        let hookCalls = 0;
        const store = storeWith({
          schema: storeSchema,
          hooks: {
            onBeforeSchemaCreated: () => {
              hookCalls++;
            },
          },
        });

        try {
          await assertThrowsAsync(
            () => store.schema.migrate({ dryRun: 'transactional' }),
            (error) => error instanceof InvalidOperationError,
          );

          assertEqual(hookCalls, 0);
          assertFalse(await exists(migrationTableName));
        } finally {
          await store.close();
        }
      },
    );
  }

  void it(
    'returns pending migrations in a diff dry run without applying them or running the schema hooks',
    withDeadline,
    async () => {
      let hookCalls = 0;
      const store = storeWith({
        schema: { autoMigration: 'EnsureMigrated', ...storeSchema },
        hooks: {
          onBeforeSchemaCreated: () => {
            hookCalls++;
          },
          onAfterSchemaCreated: () => {
            hookCalls++;
          },
        },
      });

      try {
        const dryRun = await store.schema.migrate({ dryRun: 'diff' });

        assertTrue(dryRun.applied.length > 0);
        assertEqual(hookCalls, 0);
        assertFalse(await exists('emt_streams'));
        assertFalse(await exists(migrationTableName));
        await assertThrowsAsync(
          () => store.init(),
          (error) => error instanceof PendingMigrationsError,
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'reads no migration history after the first operation, in appends, sessions and processor message stores',
    withDeadline,
    async () => {
      const reactionStream = `reaction-${uuid()}`;
      const store = storeWith({
        schema: { autoMigration: 'EnsureMigrated', ...storeSchema },
      });

      try {
        await store.schema.migrate();
        await append(store);
        await dropMigrationTable();

        await append(store);
        await store.withSession(({ eventStore }) => append(eventStore));

        const consumer = store.consumer<ProductItemAdded>();
        consumer.reactor({
          processorId: 'processor',
          startFrom: 'BEGINNING',
          canHandle: ['ProductItemAdded'],
          eachMessage: async (_, context) => {
            await context.session.messageStore.appendToStream(reactionStream, [
              {
                type: 'DiscountApplied',
                data: { percent: 10, couponId: uuid() },
              },
            ]);
          },
        });
        try {
          void consumer.start();
          await consumer.whenStarted();
          await consumer.whenCaughtUp();
        } finally {
          await consumer.close();
        }

        const reactions = await store.readStream(reactionStream);
        assertEqual(reactions.events.length, 3);
        assertFalse(await exists(migrationTableName));
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'shares the store initialization with a session that runs first',
    withDeadline,
    async () => {
      const initCalls: ProjectionHandlingType[] = [];
      let hookCalls = 0;
      const store = storeWith({
        schema: storeSchema,
        projections: projections.inline([
          countingProjection('inline_projection', initCalls),
        ]),
        hooks: {
          onAfterSchemaCreated: () => {
            hookCalls++;
          },
        },
      });

      try {
        await store.withSession(({ eventStore }) => append(eventStore));
        await store.withSession(({ eventStore }) => append(eventStore));
        await append(store);

        assertDeepEqual(initCalls, ['inline']);
        assertEqual(hookCalls, 1);
      } finally {
        await store.close();
      }
    },
  );

  void describe('with a changed migration hash', () => {
    const asyncProjections = projections.async([
      shoppingCartSummary('async_summary'),
    ]);

    const storeAfterCollectionHashChanged = async (
      ignoreMigrationHashMismatch?: boolean,
    ) => {
      const migrated = storeWith({
        schema: storeSchema,
        projections: asyncProjections,
      });
      try {
        await migrated.schema.migrate();
      } finally {
        await migrated.close();
      }
      await execute().command(
        SQL`UPDATE ${SQL.identifier(migrationTableName)} SET sql_hash = 'changed' WHERE name LIKE '%async_summary%'`,
      );

      return storeWith({
        schema:
          ignoreMigrationHashMismatch === undefined
            ? storeSchema
            : { ignoreMigrationHashMismatch, ...storeSchema },
        projections: asyncProjections,
      });
    };

    const isHashMismatch = (error: unknown) =>
      error instanceof InvalidOperationError;

    void it(
      'initializes and ensures migrated with the ignoreMigrationHashMismatch setting',
      withDeadline,
      async () => {
        const store = await storeAfterCollectionHashChanged(true);

        try {
          await store.init();
          await store.schema.ensureMigrated();
        } finally {
          await store.close();
        }
      },
    );

    void it(
      'rejects init without the ignoreMigrationHashMismatch setting',
      withDeadline,
      async () => {
        const store = await storeAfterCollectionHashChanged();

        try {
          await assertThrowsAsync(() => store.init(), isHashMismatch);
        } finally {
          await store.close();
        }
      },
    );

    void it(
      'rejects ensuring migrated without the ignoreMigrationHashMismatch setting',
      withDeadline,
      async () => {
        const store = await storeAfterCollectionHashChanged();

        try {
          await assertThrowsAsync(
            () => store.schema.ensureMigrated(),
            isHashMismatch,
          );
        } finally {
          await store.close();
        }
      },
    );

    void it(
      'lets a per-call migrate option override the ignoreMigrationHashMismatch setting',
      withDeadline,
      async () => {
        const store = await storeAfterCollectionHashChanged(true);

        try {
          await assertThrowsAsync(
            () => store.schema.migrate({ ignoreMigrationHashMismatch: false }),
            isHashMismatch,
          );
        } finally {
          await store.close();
        }
      },
    );
  });
};

type ShoppingCartSummary = { productItemsCount: number };

const shoppingCartSummary = (collectionName: string) =>
  pongoSingleStreamProjection<ShoppingCartSummary, ProductItemAdded>({
    collectionName,
    canHandle: ['ProductItemAdded'],
    evolve: (document: ShoppingCartSummary, event: ProductItemAdded) => ({
      productItemsCount:
        document.productItemsCount + event.data.productItem.quantity,
    }),
    initialState: () => ({ productItemsCount: 0 }),
  });
