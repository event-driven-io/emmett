// Can today's `Event<...>` type also accept a definition, so `type X = Event<typeof X>` works,
// while every existing use of `Event<...>` keeps compiling?
import type {
  DefaultRecord,
  Decider,
  Command,
  Event as EmmettEvent,
} from '@event-driven-io/emmett';
import { Event as defineEvent, s } from '../lib';

type AnyDefinition = { readonly Type: EmmettEvent };
type IsAny<T> = 0 extends 1 & T ? true : false;

// Today's signature, with the first parameter also accepting a definition
type Event<
  EventType extends string | AnyDefinition = string,
  EventData extends DefaultRecord = DefaultRecord,
  EventMetaData extends DefaultRecord | undefined = undefined,
> =
  IsAny<EventType> extends true
    ? EmmettEvent<string, EventData, EventMetaData>
    : EventType extends AnyDefinition
      ? EventType['Type']
      : EventType extends string
        ? EmmettEvent<EventType, EventData, EventMetaData>
        : never;
const Event = defineEvent;

/////////// New: definition plus Event<typeof X>
type ShoppingCartEventMetadata = { clientId: string };

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: { shoppingCartId: s.string(), confirmedAt: s.date() },
  metadata: { clientId: s.string() },
});
export type ShoppingCartConfirmed = Event<typeof ShoppingCartConfirmed>;

/////////// Today: hand-written type, unchanged
export type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  { shoppingCartId: string; cancelledAt: Date },
  ShoppingCartEventMetadata
>;

/////////// Plain union, as today
export type ShoppingCartEvent = ShoppingCartConfirmed | ShoppingCartCancelled;

/////////// Checks
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const assert = <T extends true>() => {};

assert<
  Equals<
    ShoppingCartConfirmed,
    EmmettEvent<'ShoppingCartConfirmed', { shoppingCartId: string; confirmedAt: Date }, ShoppingCartEventMetadata>
  >
>();
// Existing forms still mean the same thing
assert<Equals<Event, EmmettEvent>>();
assert<Equals<Event<'X'>, EmmettEvent<'X'>>>();
assert<Equals<Event<'X', { a: string }>, EmmettEvent<'X', { a: string }>>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
assert<Equals<Event<any, any, any>, EmmettEvent<string, any, any>>>();

// Generic constraints in user code
const typeOf = <E extends Event>(e: E): E['type'] => e.type;

// Union narrows as today
export const evolve = (state: string, event: ShoppingCartEvent): string => {
  switch (event.type) {
    case 'ShoppingCartConfirmed':
      return event.data.confirmedAt.toISOString();
    case 'ShoppingCartCancelled':
      return event.data.cancelledAt.toISOString();
  }
};

// Works with Emmett's own Decider
export const decider: Decider<string, Command<'Noop'>, ShoppingCartEvent> = {
  decide: () => [],
  evolve,
  initialState: () => '',
};

// Factory creates the event
export const created: ShoppingCartConfirmed = ShoppingCartConfirmed(
  { shoppingCartId: '1', confirmedAt: new Date() },
  { clientId: 'c1' },
);
export const t = typeOf(created);

/////////// Interface form, to keep the name in hovers
export const ShoppingCartOpened = Event('ShoppingCartOpened', {
  data: { shoppingCartId: s.string(), openedAt: s.date() },
  metadata: { clientId: s.string() },
});
export interface ShoppingCartOpened extends Event<typeof ShoppingCartOpened> {}

export type ShoppingCartEventWithOpened = ShoppingCartOpened | ShoppingCartEvent;
assert<
  Equals<
    ShoppingCartOpened['data'],
    { shoppingCartId: string; openedAt: Date }
  >
>();
export const opened: ShoppingCartOpened = ShoppingCartOpened(
  { shoppingCartId: '1', openedAt: new Date() },
  { clientId: 'c1' },
);
