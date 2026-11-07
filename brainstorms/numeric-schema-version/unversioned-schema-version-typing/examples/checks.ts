import type {
  AnyCommand,
  AnyEvent,
  AnyMessage,
  Command,
  Event,
  Message,
  RecordedMessage,
} from './typing';
import { event, upcastRecordedMessage } from './typing';

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
const assertType = <T extends true>(): T | undefined => undefined;

type ProductItem = { productId: string; quantity: number };
type D1 = { productId: string };
type D2 = { productItem: ProductItem };

type V1 = Event<'ProductItemAdded', D1>;
type V2 = Event<'ProductItemAdded', D2, undefined, 2>;

const d1: D1 = { productId: 'p' };
const d2: D2 = { productItem: { productId: 'p', quantity: 1 } };
const v2: V2 = { type: 'ProductItemAdded', data: d2, schemaVersion: 2 };

// ===CHECK a: event narrowing with switch (criterion 1.1)
export const narrowEvent = (e: V1 | V2): V2 => {
  switch (e.schemaVersion) {
    case 2: {
      const data = e.data;
      assertType<Equals<typeof data, D2>>();
      // @ts-expect-error V2 data has no productId
      void e.data.productId;
      return e;
    }
    default: {
      const data = e.data;
      assertType<Equals<typeof data, D1>>();
      // @ts-expect-error V1 data has no productItem
      void e.data.productItem;
      return {
        type: 'ProductItemAdded',
        data: { productItem: { productId: data.productId, quantity: 1 } },
        schemaVersion: 2,
      };
    }
  }
};

export const narrowEventExplicitCases = (e: V1 | V2): D1 | D2 => {
  switch (e.schemaVersion) {
    case undefined:
    case 1: {
      const data = e.data;
      assertType<Equals<typeof data, D1>>();
      return data;
    }
    case 2: {
      const data = e.data;
      assertType<Equals<typeof data, D2>>();
      return data;
    }
  }
  return d1;
};

// ===CHECK b: V1 values (criterion 1.2)
export const v1NoVersion: V1 = { type: 'ProductItemAdded', data: d1 };
export const v1Version1: V1 = {
  type: 'ProductItemAdded',
  data: d1,
  schemaVersion: 1,
};

// ===CHECK c: commands (criterion 1.3) and Message unions
type C1 = Command<'AddProductItem', D1>;
type C3 = Command<'AddProductItem', D2, undefined, 3>;
export const c1NoVersion: C1 = { type: 'AddProductItem', data: d1 };
export const c3: C3 = { type: 'AddProductItem', data: d2, schemaVersion: 3 };

export const narrowCommand = (c: C1 | C3): D1 | D2 => {
  switch (c.schemaVersion) {
    case 3: {
      const data = c.data;
      assertType<Equals<typeof data, Readonly<D2>>>();
      return data;
    }
    default: {
      const data = c.data;
      assertType<Equals<typeof data, Readonly<D1>>>();
      return data;
    }
  }
};

type M1 = Message<'ProductItemAdded', D1>;
type M2 = Message<'ProductItemAdded', D2, undefined, 2>;
export const narrowMessage = (m: M1 | M2): D1 | D2 => {
  switch (m.schemaVersion) {
    case 2: {
      const data = m.data;
      assertType<Equals<typeof data, D2 | Readonly<D2>>>();
      return data;
    }
    default: {
      const data = m.data;
      assertType<Equals<typeof data, D1 | Readonly<D1>>>();
      return data;
    }
  }
};

export const narrowMixed = (m: V1 | V2 | C1 | C3): string => {
  switch (m.schemaVersion) {
    case 2:
      assertType<Equals<typeof m, V2>>();
      return m.data.productItem.productId;
    case 3:
      assertType<Equals<typeof m, C3>>();
      return m.data.productItem.productId;
    default:
      assertType<Equals<typeof m, V1 | C1>>();
      return m.data.productId;
  }
};

// ===CHECK d: generic constraints
const acceptEvent = <T extends Event = Event>(e: T): T => e;
acceptEvent(v1NoVersion);
acceptEvent(v2);
acceptEvent<V1 | V2>(v2);
acceptEvent<V2>(v2);
const acceptAnyEvent = <T extends AnyEvent>(e: T): T => e;
acceptAnyEvent(v1NoVersion);
acceptAnyEvent(v2);
acceptAnyEvent<V1 | V2>(v2);
const acceptCommand = <T extends Command = Command>(c: T): T => c;
acceptCommand(c1NoVersion);
acceptCommand(c3);
acceptCommand<C1 | C3>(c3);
const acceptAnyCommand = <T extends AnyCommand>(c: T): T => c;
acceptAnyCommand<C1 | C3>(c3);
const acceptMessage = <T extends Message = Message>(m: T): T => m;
acceptMessage(v1NoVersion);
acceptMessage(v2);
acceptMessage(c3);
acceptMessage<V1 | V2 | C1 | C3>(c3);
acceptMessage<M1 | M2>(v2);
const acceptAnyMessage = <T extends AnyMessage>(m: T): T => m;
acceptAnyMessage<V1 | V2 | C1 | C3>(c3);
type EventConstraint<T extends Event> = T;
type MessageConstraint<T extends Message> = T;
export type ConstraintUses = [
  EventConstraint<V2>,
  EventConstraint<V1 | V2>,
  MessageConstraint<V1 | V2 | C1 | C3>,
];
export const readVersionGeneric = <T extends Event>(e: T): number | undefined =>
  e.schemaVersion;

// ===CHECK e: assignability to bare types and arrays
export const asEvent: Event = v2;
export const asMessage: Message = v2;
export const asAnyEvent: AnyEvent = v2;
export const asCommand: Command = c3;
export const events: Event[] = [v1NoVersion, v2];
export const messages: Message[] = [v1NoVersion, v2, c1NoVersion, c3];

// ===CHECK f: recorded messages
type RecordedV1V2 = RecordedMessage<V1 | V2>;
export const narrowRecorded = (e: RecordedV1V2): D1 | D2 => {
  assertType<Equals<typeof e.schemaVersion, 1 | 2>>();
  switch (e.schemaVersion) {
    case 2: {
      const data = e.data;
      assertType<Equals<typeof data, D2>>();
      return data;
    }
    default: {
      const data = e.data;
      assertType<Equals<typeof data, D1>>();
      return data;
    }
  }
};
assertType<Equals<RecordedMessage['schemaVersion'], number>>();
assertType<Equals<RecordedMessage<Event>['schemaVersion'], number>>();
assertType<Equals<RecordedMessage<V2>['schemaVersion'], 2>>();
export const readRecordedGeneric = <T extends Event>(
  e: RecordedMessage<T>,
): number => e.schemaVersion;

// ===CHECK g: upcast function
export const upcast = (e: V1 | V2): V2 =>
  e.schemaVersion === 2
    ? e
    : {
        type: 'ProductItemAdded',
        data: { productItem: { productId: e.data.productId, quantity: 1 } },
        schemaVersion: 2,
      };
declare const recorded: RecordedMessage<V1 | V2>;
export const upcasted = upcastRecordedMessage<V2, V1 | V2>(recorded, {
  upcast,
});

// ===CHECK h: helpers (criterion 2, side check)
export const helperV2 = event<V2>('ProductItemAdded', d2, 2);
// @ts-expect-error version is required when the type declares one
event<V2>('ProductItemAdded', d2);
export const helperV1 = event<V1>('ProductItemAdded', d1);
// @ts-expect-error version is not accepted when the type declares none
event<V1>('ProductItemAdded', d1, 1);

// ===CHECK i: concrete handler where an AnyEvent/AnyMessage handler is expected (as ProjectionDefinition<AnyEvent> does)
type EventsHandler<E extends AnyEvent> = (events: E[]) => void;
const v1v2Handler: EventsHandler<V1 | V2> = () => {};
export const asAnyEventsHandler: EventsHandler<AnyEvent> = v1v2Handler;
type MessageHandler<M extends AnyMessage> = (message: M) => void;
const mixedHandler: MessageHandler<V1 | V2 | C1 | C3> = () => {};
export const asAnyMessageHandler: MessageHandler<AnyMessage> = mixedHandler;
