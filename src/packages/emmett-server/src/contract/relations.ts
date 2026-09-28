export const EmmettDocumentationBaseUrl = 'https://docs.emmett.dev';

export const EmmettCurie = {
  name: 'emmett',
  href: `${EmmettDocumentationBaseUrl}/rels/{rel}`,
  templated: true,
} as const;

export const EventStoreApiProfile = `${EmmettDocumentationBaseUrl}/profiles/event-store-v1`;

/**
 * Link relations used by HAL representations.
 * Standard IANA relations are used where their semantics fit.
 */
export const Relations = {
  self: 'self',
  serviceDesc: 'service-desc',
  describedBy: 'describedby',
  profile: 'profile',
  collection: 'collection',
  up: 'up',
  first: 'first',
  prev: 'prev',
  next: 'next',
  streams: 'emmett:streams',
  stream: 'emmett:stream',
  messages: 'emmett:messages',
  find: 'emmett:find',
  subscriptions: 'emmett:subscriptions',
  capabilities: 'emmett:capabilities',
  aggregates: 'emmett:aggregates',
} as const;
