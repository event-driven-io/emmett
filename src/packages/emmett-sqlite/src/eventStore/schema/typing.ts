export const emmettPrefix = 'emt';

export const globalTag = 'global';
export const defaultTag = 'emt:default';

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
