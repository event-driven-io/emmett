import {
  CommandHandler,
  getInMemoryEventStore,
  projection,
  reactor,
  type AnyMessageHandlerContext,
  type AnyReadEventMetadata,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import type { D1, D2, Stored, V1, V2 } from './domain';

const d2: D2 = { productItem: { productId: 'p', quantity: 1 } };
type Cart = { n: number };

// i1: CommandHandler with inline upcast and downcast
export const i1 = CommandHandler<Cart, V2, Stored>({
  evolve: (s, e) => ({ n: s.n + e.schemaVersion }),
  initialState: () => ({ n: 0 }),
  schema: {
    versioning: {
      upcast: (e) =>
        e.schemaVersion === 2
          ? e
          : { type: 'ProductItemAdded', data: { productItem: { productId: e.data.productId, quantity: 1 } }, schemaVersion: 2 },
      downcast: (e) => ({ type: 'ProductItemAdded', data: { productId: e.data.productItem.productId }, schemaVersion: 1 }),
    },
  },
});
// i1b: inline downcast without a version
export const i1b = CommandHandler<Cart, V2, Stored>({
  evolve: (s) => s,
  initialState: () => ({ n: 0 }),
  schema: {
    versioning: {
      // @ts-expect-error i1b: downcast result without a version
      downcast: (e) => ({ type: 'ProductItemAdded', data: { productId: e.data.productItem.productId } }),
    },
  },
});
// i1c: a named downcaster annotated with the plain V1 return type
const downcastAnnotated = (e: V2): V1 => ({ type: 'ProductItemAdded', data: { productId: e.data.productItem.productId }, schemaVersion: 1 });
export const i1c = CommandHandler<Cart, V2, V1>({
  evolve: (s) => s,
  initialState: () => ({ n: 0 }),
  // @ts-expect-error i1c: V1 as a return type allows no version
  schema: { versioning: { downcast: downcastAnnotated } },
});
// i1d: a named downcaster without a return annotation
const downcastInferred = (e: V2) => ({ type: 'ProductItemAdded' as const, data: { productId: e.data.productItem.productId } as D1, schemaVersion: 1 as const });
export const i1d = CommandHandler<Cart, V2, V1>({
  evolve: (s) => s,
  initialState: () => ({ n: 0 }),
  schema: { versioning: { downcast: downcastInferred } },
});

// i2: reactor with inline upcast
export const i2 = reactor<V2, AnyReadEventMetadata, AnyMessageHandlerContext, Stored>({
  processorId: 'r',
  eachMessage: (m) => {
    const two: 2 = m.schemaVersion;
    void two;
  },
  messageOptions: {
    schema: {
      versioning: {
        upcast: (e) => (e.schemaVersion === 2 ? e : { type: 'ProductItemAdded', data: d2, schemaVersion: 2 }),
      },
    },
  },
});

// i3: readStream, appendToStream, aggregateStream with inline functions
export const i3 = async () => {
  const store = getInMemoryEventStore();
  const read = await store.readStream<V2, Stored>('id', {
    schema: { versioning: { upcast: (e) => (e.schemaVersion === 2 ? e : { type: 'ProductItemAdded', data: d2, schemaVersion: 2 }) } },
  });
  await store.appendToStream<V2, Stored>('id', read.events, {
    schema: { versioning: { downcast: (e) => ({ type: 'ProductItemAdded', data: { productId: e.data.productItem.productId }, schemaVersion: 1 }) } },
  });
  await store.aggregateStream<Cart, V2, Stored>('id', {
    evolve: (s: Cart) => s,
    initialState: () => ({ n: 0 }),
    read: { schema: { versioning: { upcast: (e) => (e.schemaVersion === 2 ? e : { type: 'ProductItemAdded', data: d2, schemaVersion: 2 }) } } },
  });
  // @ts-expect-error i3b: readStream upcast to V2 without a version
  await store.readStream<V2, Stored>('id', { schema: { versioning: { upcast: () => ({ type: 'ProductItemAdded', data: d2 }) } } });
};

// i4: workflow options and projection eventsOptions
export const i4: WorkflowOptions<V2, Cart, V2, AnyReadEventMetadata, Stored>['schema'] = {
  versioning: {
    upcast: (e) => (e.schemaVersion === 2 ? e : { type: 'ProductItemAdded', data: d2, schemaVersion: 2 }),
    downcast: (e) => e,
  },
};
export const i5 = projection<V2, AnyReadEventMetadata, never, Stored>({
  canHandle: ['ProductItemAdded'],
  handle: () => Promise.resolve(),
  eventsOptions: {
    schema: { versioning: { upcast: (e) => (e.schemaVersion === 2 ? e : { type: 'ProductItemAdded', data: d2, schemaVersion: 2 }) } },
  },
});

// i6: unversioned inline functions, unchanged
type A = { type: 'A'; data: { a: string } };
type B = { type: 'B'; data: { b: string } };
export const i6 = CommandHandler<Cart, B, A>({
  evolve: (s) => s,
  initialState: () => ({ n: 0 }),
  schema: {
    versioning: {
      upcast: (e) => ({ type: 'B', data: { b: e.data.a } }),
      downcast: (e) => ({ type: 'A', data: { a: e.data.b } }),
    },
  },
});
