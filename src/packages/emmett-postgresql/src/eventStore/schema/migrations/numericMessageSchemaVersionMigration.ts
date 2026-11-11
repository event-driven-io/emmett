import { SQL, sqlMigration, type SQLMigration } from '@event-driven-io/dumbo';
import { messagesTable, tableReference } from '../typing';

export type NumericMessageSchemaVersionMigrationOptions = {
  databaseSchemaName?: string | undefined;
  messageSchemaVersionMapping?: SQL | undefined;
};

const numericColumnVersion = SQL`
  CASE
    WHEN message_schema_version ~ '^[0-9]+$' THEN message_schema_version::int
  END`;

const numericMetadataVersion = SQL`
  CASE jsonb_typeof(message_metadata -> 'schemaVersion')
    WHEN 'number' THEN
      CASE
        WHEN (message_metadata ->> 'schemaVersion')::numeric >= 0
          AND (message_metadata ->> 'schemaVersion')::numeric = trunc((message_metadata ->> 'schemaVersion')::numeric)
        THEN (message_metadata ->> 'schemaVersion')::numeric::int
      END
    WHEN 'string' THEN
      CASE
        WHEN message_metadata ->> 'schemaVersion' ~ '^[0-9]+$' THEN (message_metadata ->> 'schemaVersion')::int
      END
  END`;

const numericMessageSchemaVersionSQL = (
  options: NumericMessageSchemaVersionMigrationOptions,
) => {
  const { databaseSchemaName, messageSchemaVersionMapping } = options;
  const userMapping = messageSchemaVersionMapping
    ? SQL`${messageSchemaVersionMapping},`
    : SQL``;

  return SQL`
DO $emt_numeric_schema_version$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = ${databaseSchemaName === undefined ? SQL`current_schema()` : SQL.literal(databaseSchemaName)}
      AND table_name = '${SQL.plain(messagesTable.name)}'
      AND column_name = 'message_schema_version'
      AND data_type <> 'integer'
  ) THEN
    ALTER TABLE ${tableReference(databaseSchemaName, messagesTable.name)}
      ALTER COLUMN message_schema_version TYPE INT
      USING COALESCE(${userMapping} ${numericColumnVersion}, ${numericMetadataVersion}, 1);
  END IF;
END $emt_numeric_schema_version$;
`;
};

export const numericMessageSchemaVersionMigrationFor = (
  name: string,
  options: NumericMessageSchemaVersionMigrationOptions = {},
): SQLMigration =>
  sqlMigration(name, [numericMessageSchemaVersionSQL(options)], {
    ignoreHashMismatch: true,
  });
