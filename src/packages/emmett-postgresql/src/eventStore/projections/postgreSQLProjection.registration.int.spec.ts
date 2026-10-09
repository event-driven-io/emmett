import { dumbo } from '@event-driven-io/dumbo';
import { pgDumboDriver, type PgPool } from '@event-driven-io/dumbo/pg';
import { assertEqual, assertIsNotNull } from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { pgEventStoreDriver } from '../../pg';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import type { ProductItemAdded } from '../../testing/shoppingCart.domain';
import { getPostgreSQLEventStore } from '../postgreSQLEventStore';
import { postgreSQLProjection, readProjectionInfo } from '.';

const withDeadline = { timeout: 30000 };

void describe('PostgreSQL projection registration', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let pool: PgPool;
  const productItem = { price: 10, productId: uuid(), quantity: 10 };

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;
    pool = dumbo({ connectionString, driver: pgDumboDriver });
  });

  afterAll(async () => {
    try {
      await pool?.close();
      await database?.close();
    } catch (error) {
      console.log(error);
    }
  });

  const shoppingCartProjection = (name: string) =>
    postgreSQLProjection<ProductItemAdded>({
      name,
      canHandle: ['ProductItemAdded'],
      handle: () => {},
    });

  const registrationType = async (databaseSchemaName: string, name: string) => {
    const registration = await readProjectionInfo(pool.execute, {
      databaseSchemaName,
      name,
      partition: 'emt:default',
      version: 1,
    });
    assertIsNotNull(registration);
    return registration.registration.type;
  };

  void it(
    'registers an inline projection as inline',
    withDeadline,
    async () => {
      const databaseSchemaName = schemaName('events');
      const projectionName = schemaName('inline_projection');
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: { databaseSchemaName },
        projections: [
          {
            type: 'inline',
            projection: shoppingCartProjection(projectionName),
          },
        ],
      });

      try {
        await store.schema.migrate();

        assertEqual(
          await registrationType(databaseSchemaName, projectionName),
          'inline',
        );
      } finally {
        await store.close();
      }
    },
  );

  void it(
    'registers a projector projection as async',
    withDeadline,
    async () => {
      const databaseSchemaName = schemaName('events');
      const projectionName = schemaName('async_projection');
      const store = getPostgreSQLEventStore({
        driver: pgEventStoreDriver,
        connectionString,
        schema: { databaseSchemaName },
      });

      try {
        await store.schema.migrate();

        const consumer = store.consumer<ProductItemAdded>({
          stopWhen: { noMessagesLeft: true },
        });
        consumer.projector({
          processorId: schemaName('processor'),
          projection: shoppingCartProjection(projectionName),
        });

        await store.appendToStream(`shopping_cart-${uuid()}`, [
          { type: 'ProductItemAdded', data: { productItem } },
        ]);
        await consumer.start();

        assertEqual(
          await registrationType(databaseSchemaName, projectionName),
          'async',
        );
      } finally {
        await store.close();
      }
    },
  );
});

const schemaName = (prefix: string) =>
  `${prefix}_${uuid().replaceAll('-', '_')}`;
