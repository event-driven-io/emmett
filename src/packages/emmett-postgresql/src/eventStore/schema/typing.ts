export const emmettPrefix = 'emt';

export const globalTag = 'global';
export const defaultTag = 'emt:default';

export const globalNames = {
  module: `${emmettPrefix}:module:${globalTag}`,
  tenant: `${emmettPrefix}:tenant:${globalTag}`,
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

export const eventsTable = {
  name: `${emmettPrefix}_events`,
  columns: {
    partition: columns.partition,
    isArchived: columns.isArchived,
  },
};

export const subscriptionsTable = {
  name: `${emmettPrefix}_subscriptions`,
};
