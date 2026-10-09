import {
  databaseComponent,
  databaseSchemaComponent,
  isSchemaComponent,
  SQL,
  sqlMigration,
  tableComponent,
} from '@event-driven-io/dumbo';
import { assertDeepEqual } from '@event-driven-io/emmett';
import { describe, it } from 'vitest';
import type { ProductItemAdded } from '../../../../testing/shoppingCart.domain';
import {
  sqliteRawBatchSQLProjection,
  sqliteRawSQLProjection,
} from '../../../../eventStore/projections/sqliteProjection';

const table = (tableName: string) =>
  tableComponent({
    tableName,
    migrations: (fullName) => [
      sqlMigration(
        `create:${fullName.databaseSchemaName}:${fullName.tableName}`,
        [SQL`SELECT 1;`],
      ),
    ],
  });

const migrationNames = (schema: unknown) => {
  if (!isSchemaComponent(schema))
    throw new Error('Projection exposes no schema component');
  return schema.migrations().map(({ name }) => name);
};

void describe('SQLite raw SQL projection schema', () => {
  void it('places its tables in the default schema it receives', () => {
    const projection = sqliteRawSQLProjection<ProductItemAdded>({
      name: 'product_sales',
      canHandle: ['ProductItemAdded'],
      schema: databaseComponent({ tables: { sales: table('sales') } }),
      evolve: () => SQL`SELECT 1;`,
    }).withDefaultSchemaName!('read_models');

    assertDeepEqual(migrationNames(projection.schema), [
      'schema:read_models:create',
      'create:read_models:sales',
    ]);
  });

  void it('keeps a table schema set in its definition', () => {
    const projection = sqliteRawBatchSQLProjection<ProductItemAdded>({
      name: 'product_sales',
      canHandle: ['ProductItemAdded'],
      schema: databaseComponent({
        schemas: {
          sales: databaseSchemaComponent({
            schemaName: 'sales',
            tables: { sales: table('sales') },
          }),
        },
      }),
      evolve: () => [SQL`SELECT 1;`],
    }).withDefaultSchemaName!('read_models');

    assertDeepEqual(migrationNames(projection.schema), [
      'schema:read_models:create',
      'schema:sales:create',
      'create:sales:sales',
    ]);
  });

  void it('exposes its schema unchanged without a default schema', () => {
    const projection = sqliteRawSQLProjection<ProductItemAdded>({
      name: 'product_sales',
      canHandle: ['ProductItemAdded'],
      schema: databaseComponent({ tables: { sales: table('sales') } }),
      evolve: () => SQL`SELECT 1;`,
    });

    assertDeepEqual(migrationNames(projection.schema), [
      'create:dmb_default_schema:sales',
    ]);
  });
});
