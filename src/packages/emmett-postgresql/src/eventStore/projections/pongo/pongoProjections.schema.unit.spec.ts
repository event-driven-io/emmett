import { isSchemaComponent, type SQLMigration } from '@event-driven-io/dumbo';
import { assertDeepEqual } from '@event-driven-io/emmett';
import {
  pongoClient,
  pongoSchema,
  type PongoDBCollectionOptions,
} from '@event-driven-io/pongo';
import { pgDriver as pgPongoDriver } from '@event-driven-io/pongo/pg';
import { afterAll, describe, it } from 'vitest';
import {
  pongoMultiStreamProjection,
  pongoSingleStreamProjection,
} from './pongoProjections';

type Cart = { _id?: string; status: string };
type CartOpened = { type: 'CartOpened'; data: { cartId: string } };

const connectionString = 'postgresql://localhost:5432/postgres';

void describe('PostgreSQL Pongo projection schema', () => {
  const pongoClients: ReturnType<typeof pongoClient>[] = [];

  afterAll(async () => {
    await Promise.all(pongoClients.map((client) => client.close()));
  });

  const describeMigrations = (migrations: ReadonlyArray<SQLMigration>) =>
    migrations.map(({ name, sqls }) => ({ name, sqls }));

  const pongoDbMigrations = (
    defaultSchemaName: string | undefined,
    collectionName: string,
    collectionOptions?: PongoDBCollectionOptions<Cart>,
  ) => {
    const client = pongoClient({
      driver: pgPongoDriver,
      connectionString,
      defaultSchemaName,
    });
    pongoClients.push(client);
    const db = client.db();
    db.collection<Cart>(collectionName, collectionOptions);

    return db.schema.migrations;
  };

  const cartsProjection = (
    options: {
      version?: number;
      collectionOptions?: PongoDBCollectionOptions<Cart>;
    } = {},
  ) =>
    pongoMultiStreamProjection<Cart, CartOpened>({
      collectionName: 'carts',
      canHandle: ['CartOpened'],
      getDocumentId: (event) => event.data.cartId,
      evolve: (document: Cart | null) => document,
      ...options,
    });

  const schemaMigrations = (schema: unknown) => {
    if (!isSchemaComponent(schema))
      throw new Error('Projection exposes no schema component');
    return describeMigrations(schema.migrations());
  };

  void it('exposes its collection as a Pongo database without a default schema does', () => {
    const projection = cartsProjection();

    assertDeepEqual(
      schemaMigrations(projection.schema),
      describeMigrations(pongoDbMigrations(undefined, 'carts')),
    );
  });

  void it('exposes its collection in the default schema it receives', () => {
    const projection = cartsProjection().withDefaultSchemaName!('read_models');

    assertDeepEqual(
      schemaMigrations(projection.schema),
      describeMigrations(pongoDbMigrations('read_models', 'carts')),
    );
  });

  void it('keeps the collection schema set in its definition', () => {
    const collectionOptions: PongoDBCollectionOptions<Cart> = {
      databaseSchemaName: 'carts_schema',
    };
    const projection = cartsProjection({
      collectionOptions,
    }).withDefaultSchemaName!('read_models');

    assertDeepEqual(
      schemaMigrations(projection.schema),
      describeMigrations(
        pongoDbMigrations('read_models', 'carts', collectionOptions),
      ),
    );
  });

  void it('exposes the versioned collection name', () => {
    const projection = cartsProjection({ version: 2 });

    assertDeepEqual(
      schemaMigrations(projection.schema),
      describeMigrations(pongoDbMigrations(undefined, 'carts_v2')),
    );
  });

  void it('keeps the indexes of the collection definition', () => {
    const collectionOptions: PongoDBCollectionOptions<Cart> = {
      definition: pongoSchema.collection<Cart>('carts', {
        indexes: {
          status: pongoSchema.index('carts_status_idx', 'status'),
        },
      }),
    };
    const projection = cartsProjection({
      collectionOptions,
    }).withDefaultSchemaName!('read_models');

    assertDeepEqual(
      schemaMigrations(projection.schema),
      describeMigrations(
        pongoDbMigrations('read_models', 'carts', collectionOptions),
      ),
    );
  });

  void it('exposes the schema of a single-stream projection', () => {
    const projection = pongoSingleStreamProjection<Cart, CartOpened>({
      collectionName: 'carts',
      canHandle: ['CartOpened'],
      evolve: (document: Cart | null) => document,
    }).withDefaultSchemaName!('read_models');

    assertDeepEqual(
      schemaMigrations(projection.schema),
      describeMigrations(pongoDbMigrations('read_models', 'carts')),
    );
  });
});
