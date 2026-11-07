import {
  CommandHandler,
  downcastRecordedMessage,
  getInMemoryEventStore,
  JSONCodec,
  reactor,
  upcastRecordedMessage,
  type AnyMessageHandlerContext,
  type AnyReadEventMetadata,
  type Command,
  type MessageDowncast,
  type MessageUpcast,
  type RecordedMessage,
  type WorkflowOptions,
} from '@event-driven-io/emmett';
import {
  assertType,
  v2,
  type C2,
  type Equals,
  type Stored,
  type V1,
  type V2,
} from './domain';

// payload-form upcaster written by a user
const upcast = (event: Stored): V2 => {
  switch (event.schemaVersion) {
    case 2:
      return event;
    default:
      return {
        type: 'ProductItemAdded',
        data: { productItem: { productId: event.data.productId, quantity: 1 } },
        schemaVersion: 2,
      };
  }
};

// an upcaster that forgets the version does not compile, because V2 requires it
// @ts-expect-error schemaVersion missing on V2
export const upcastForgot = (event: V1): V2 => ({
  type: 'ProductItemAdded',
  data: { productItem: { productId: event.data.productId, quantity: 1 } },
});

// payload-form downcaster: V2 -> V1, version left out (spec 9.2 keeps 2 at runtime)
const downcastDataOnly = (event: V2): V1 => ({
  type: 'ProductItemAdded',
  data: { productId: event.data.productItem.productId },
});
// downcaster that sets version 1 (spec 9.1)
const downcastWithVersion = (event: V2): V1 => ({
  type: 'ProductItemAdded',
  data: { productId: event.data.productItem.productId },
  schemaVersion: 1,
});
// downcast to the stored union
const downcastToStored = (event: V2): Stored => downcastWithVersion(event);

// d1: core helpers, payload form
declare const recorded: RecordedMessage<Stored>;
const d1 = upcastRecordedMessage<V2, Stored>(recorded, { upcast });
assertType<Equals<typeof d1.schemaVersion, 2>>();

// d2: core helpers, recorded form
const upcastRecorded = (e: RecordedMessage<Stored>): RecordedMessage<V2> => {
  switch (e.schemaVersion) {
    case 2:
      return e;
    default:
      return {
        ...e,
        data: { productItem: { productId: e.data.productId, quantity: 1 } },
        schemaVersion: 2,
      };
  }
};
upcastRecordedMessage<V2, Stored>(recorded, { upcast: upcastRecorded });
const asType: MessageUpcast<V2, Stored> = upcastRecorded;

// d3: downcast
declare const recordedV2: RecordedMessage<V2>;
const d3 = downcastRecordedMessage<V2, V1>(recordedV2, { downcast: downcastDataOnly });
assertType<Equals<typeof d3.schemaVersion, 1>>();
const d3b = downcastRecordedMessage<V2, Stored>(recordedV2, { downcast: downcastToStored });
assertType<Equals<typeof d3b.schemaVersion, 1 | 2>>();
const asDowncast: MessageDowncast<V2, Stored> = downcastToStored;

// d4: CommandHandler schema.versioning, V1 | V2 stored, V2 app type
type Cart = { items: number };
const handle = CommandHandler<Cart, V2, Stored>({
  evolve: (state, event) => {
    const two: 2 = event.schemaVersion;
    return { items: state.items + two };
  },
  initialState: () => ({ items: 0 }),
  schema: { versioning: { upcast, downcast: downcastToStored } },
});
export const d4 = async () => {
  const store = getInMemoryEventStore();
  await handle(store, 'id', () => v2);
  await handle(store, 'id', () => [v2, v2]);
  // decide returning V2 without version does not compile
  // @ts-expect-error schemaVersion missing
  await handle(store, 'id', () => ({ type: 'ProductItemAdded', data: { productItem: { productId: 'p', quantity: 1 } } }));
};

// d5: event store read/append/aggregate
export const d5 = async () => {
  const store = getInMemoryEventStore();
  const read = await store.readStream<V2, Stored>('id', { schema: { versioning: { upcast } } });
  assertType<Equals<(typeof read.events)[number]['schemaVersion'], 2>>();
  await store.appendToStream<V2, Stored>('id', [v2], { schema: { versioning: { downcast: downcastToStored } } });
  await store.appendToStream<V2, V1>('id', [v2], { schema: { versioning: { downcast: downcastDataOnly } } });
  const agg = await store.aggregateStream<Cart, V2, Stored>('id', {
    evolve: (s: Cart, e: V2) => ({ items: s.items + e.schemaVersion }),
    initialState: () => ({ items: 0 }),
    read: { schema: { versioning: { upcast } } },
  });
  return agg;
};

// d6: reactor with upcast
export const d6b = reactor<V2, AnyReadEventMetadata, AnyMessageHandlerContext, Stored>({
  processorId: 'p',
  eachMessage: (m) => {
    const two: 2 = m.schemaVersion;
    void two;
  },
  messageOptions: { schema: { versioning: { upcast } } },
});

// d7: workflow options versioning, V1 | V2 stored, V2 input and output
export const d7: WorkflowOptions<V2, Cart, V2, AnyReadEventMetadata, Stored>['schema'] = {
  versioning: { upcast, downcast: downcastToStored },
};
// d7b: stored commands C1 | C2, input C2
type C1 = Command<'AddProductItem', { productId: string }>;
const upcastC = (c: C1 | C2): C2 =>
  c.schemaVersion === 2
    ? c
    : { type: 'AddProductItem', data: { productItem: { productId: c.data.productId, quantity: 1 } }, schemaVersion: 2 };
export const d7b: WorkflowOptions<C2, Cart, C2, AnyReadEventMetadata, C1 | C2>['schema'] = {
  versioning: { upcast: upcastC, downcast: (c: C2): C1 | C2 => c },
};

// d8: JSON codec upcast/downcast with message types
const codec = JSONCodec<V2, Stored>({ upcast, downcast: downcastToStored });
const decoded = codec.decode('{}');
assertType<Equals<typeof decoded.schemaVersion, 2>>();

export { asType, asDowncast };
