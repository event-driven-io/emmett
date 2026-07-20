import { ObservabilitySpec } from '@event-driven-io/almanac';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import { EmmettAttributes } from '../observability/attributes';
import type { Event } from '../typing';
import { DeciderCommandHandler } from './handleCommandWithDecider';

type CartCommand =
  | { type: 'AddItem'; data: { productId: string } }
  | { type: 'Confirm'; data: { confirmedAt: Date } };
type CartEvent =
  | Event<'ItemAdded', { productId: string }>
  | Event<'CartConfirmed', { confirmedAt: Date }>;
type Cart = { items: string[]; confirmed: boolean };

const decide = (command: CartCommand): CartEvent =>
  command.type === 'AddItem'
    ? { type: 'ItemAdded', data: command.data }
    : { type: 'CartConfirmed', data: command.data };

const evolve = (state: Cart, event: CartEvent): Cart =>
  event.type === 'ItemAdded'
    ? { ...state, items: [...state.items, event.data.productId] }
    : { ...state, confirmed: true };

const initialState = (): Cart => ({ items: [], confirmed: false });

describe('DeciderCommandHandler observability', () => {
  const given = ObservabilitySpec.for();

  void it('forwards command.type to the span attribute for a single command', () => {
    const streamId = randomUUID();

    return given((observability) =>
      DeciderCommandHandler<Cart, CartCommand, CartEvent>({
        evolve,
        initialState,
        decide,
        observability,
      }),
    )
      .when(async (handler) =>
        handler(getInMemoryEventStore(), streamId, {
          type: 'AddItem',
          data: { productId: 'p1' },
        }),
      )
      .then(({ spans }) => {
        spans
          .hasSingleSpanNamed('command.handle')
          .hasAttribute(EmmettAttributes.command.type, 'AddItem');
      });
  });

  void it('forwards command.type as an array for multiple commands', () => {
    const streamId = randomUUID();

    return given((observability) =>
      DeciderCommandHandler<Cart, CartCommand, CartEvent>({
        evolve,
        initialState,
        decide,
        observability,
      }),
    )
      .when(async (handler) =>
        handler(getInMemoryEventStore(), streamId, [
          { type: 'AddItem', data: { productId: 'p1' } },
          { type: 'Confirm', data: { confirmedAt: new Date() } },
        ]),
      )
      .then(({ spans }) => {
        spans
          .hasSingleSpanNamed('command.handle')
          .hasAttribute(EmmettAttributes.command.type, ['AddItem', 'Confirm']);
      });
  });
});
