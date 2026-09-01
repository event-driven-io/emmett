import {
  DefaultDatabaseSchemaName,
  SQLTableReference,
} from '@event-driven-io/dumbo';

export const emmettPrefix = 'emt';

export const globalTag = 'global';
export const defaultTag = `${emmettPrefix}:default`;
export const unknownTag = `${emmettPrefix}:unknown`;

export const globalNames = {
  module: `${emmettPrefix}:module:${globalTag}`,
};

const columns = {
  partition: {
    name: 'partition',
  },
  isArchived: { name: 'is_archived' },
};

export const streamsTable = {
  name: `${emmettPrefix}_streams`,
  columns: {
    partition: columns.partition,
    isArchived: columns.isArchived,
  },
};

export const messagesTable = {
  name: `${emmettPrefix}_messages`,
  columns: {
    partition: columns.partition,
    isArchived: columns.isArchived,
  },
};

export const processorsTable = {
  name: `${emmettPrefix}_processors`,
};

export const projectionsTable = {
  name: `${emmettPrefix}_projections`,
};

export const tableReference = (
  databaseSchemaName: string | undefined,
  tableName: string,
) =>
  SQLTableReference.from({
    databaseSchemaName: databaseSchemaName ?? DefaultDatabaseSchemaName,
    tableName,
  });
