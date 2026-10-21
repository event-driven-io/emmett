import type { Event as EmmettEvent } from '@event-driven-io/emmett';
import { Event, Events, s } from '../lib';

export const Opened = Event('Opened', {
  data: { cartId: s.string(), openedAt: s.date() },
});
export interface Opened extends Event.Of<typeof Opened> {}

export const Closed = Event('Closed', { data: { cartId: s.string() } });
export interface Closed extends Event.Of<typeof Closed> {}

export const CartEvent = Events(Opened, Closed);
export type CartEvent = Opened | Closed;

export const describe = (event: CartEvent) => {
  switch (event.type) {
    case 'Opened':
      return event.data.openedAt.toISOString();
    case 'Closed':
      return event.data.cartId;
  }
};
export const asEmmett: EmmettEvent = Opened({ cartId: '1', openedAt: new Date() });
export const fromFactory: Opened = Opened({ cartId: '1', openedAt: new Date() });
export const sameAsDerived: typeof CartEvent.Type = fromFactory;
