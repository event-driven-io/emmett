import {
  getInMemoryEventStore,
  inMemoryProjection,
  projection,
  projections,
  projector,
  reactor,
  type AnyEvent,
  type AnyMessage,
  type CanHandle,
  type MessageHandler,
  type ProjectionDefinition,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import {
  getPostgreSQLEventStore,
  postgreSQLProjection,
} from '@event-driven-io/emmett-postgresql';
import type { C2, Stored, V2 } from './domain';

// f1: a V1 | V2 projection where ProjectionDefinition<AnyEvent> is expected
const p = projection<Stored>({
  name: 'p',
  canHandle: ['ProductItemAdded'],
  handle: (events) => {
    for (const e of events) {
      if (e.schemaVersion === 2) void e.data.productItem;
      else void e.data.productId;
    }
  },
});
export const f1: ProjectionDefinition<AnyEvent> = p;

// f2: inline and async registration
export const f2 = projections.inline([p]);
export const f2b = projections.async([p]);

// f3: in-memory store with an inline V1 | V2 projection
const imp = inMemoryProjection<Stored>({
  canHandle: ['ProductItemAdded'],
  handle: (events) => {
    for (const e of events) void e.schemaVersion;
    return Promise.resolve();
  },
});
export const f3 = getInMemoryEventStore({ projections: projections.inline([imp]) });

// f4: PostgreSQL store with an inline V1 | V2 projection
const pgp = postgreSQLProjection<V2, Stored>({
  canHandle: ['ProductItemAdded'],
  handle: (events) => {
    for (const e of events) {
      const two: 2 = e.schemaVersion;
      void two;
    }
    return Promise.resolve();
  },
});
export const f4 = getPostgreSQLEventStore('postgres://', { projections: projections.inline([pgp]) });

// f5: MessageHandler typed with AnyMessage receiving concrete handlers
const handlerStored: MessageHandler<Stored> = (m: RecordedMessage<Stored>) => {
  void m.schemaVersion;
};
// @ts-expect-error not assignable; the same error exists on orig/ with unversioned types (f2.messagehandler-compare.ts)
export const f5: MessageHandler<AnyMessage> = handlerStored;

// f6: reactor and projector over V1 | V2 with canHandle
export const f6 = reactor<Stored>({
  processorId: 'r',
  canHandle: ['ProductItemAdded'],
  eachMessage: (m: RecordedMessage<Stored>) => {
    switch (m.schemaVersion) {
      case 2:
        void m.data.productItem;
        break;
      default:
        void m.data.productId;
    }
  },
});
export const f6b = projector<Stored>({ projection: p });
export const f6c: CanHandle<Stored | C2> = ['ProductItemAdded', 'AddProductItem'];
