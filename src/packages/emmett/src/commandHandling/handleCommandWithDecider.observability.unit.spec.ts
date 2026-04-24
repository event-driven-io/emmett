import { collectingMeter, collectingTracer } from '@event-driven-io/almanac';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getInMemoryEventStore } from '../eventStore';
import { EmmettAttributes } from '../observability/attributes';
import type { Event } from '../typing';
import { DeciderCommandHandler } from './handleCommandWithDecider';

type AddItem = { type: 'AddItem'; data: { productId: string } };
type Confirm = { type: 'Confirm'; data: Record<string, never> };
type CartCommand = AddItem | Confirm;

type ItemAdded = Event<'ItemAdded', { productId: string }>;
type CartConfirmed = Event<'CartConfirmed', Record<string, never>>;
type CartEvent = ItemAdded | CartConfirmed;

type Cart = { items: string[]; confirmed: boolean };

const decide = (command: CartCommand): CartEvent | CartEvent[] => {
  switch (command.type) {
    case 'AddItem':
      return { type: 'ItemAdded', data: { productId: command.data.productId } };
    case 'Confirm':
      return { type: 'CartConfirmed', data: {} };
  }
};

const evolve = (state: Cart, event: CartEvent): Cart => {
  switch (event.type) {
    case 'ItemAdded':
      return { ...state, items: [...state.items, event.data.productId] };
    case 'CartConfirmed':
      return { ...state, confirmed: true };
  }
};

const initialState = (): Cart => ({ items: [], confirmed: false });

describe('DeciderCommandHandler observability', () => {
  void it('forwards command.type to the span attribute for a single command', async () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();

    const handler = DeciderCommandHandler<Cart, CartCommand, CartEvent>({
      evolve,
      initialState,
      decide,
      observability: { tracer, meter },
    });

    await handler(getInMemoryEventStore(), randomUUID(), {
      type: 'AddItem',
      data: { productId: 'p1' },
    });

    const span = tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[EmmettAttributes.command.type]).toBe('AddItem');
  });

  void it('forwards command.type as an array for multiple commands', async () => {
    const tracer = collectingTracer();
    const meter = collectingMeter();

    const handler = DeciderCommandHandler<Cart, CartCommand, CartEvent>({
      evolve,
      initialState,
      decide,
      observability: { tracer, meter },
    });

    await handler(getInMemoryEventStore(), randomUUID(), [
      { type: 'AddItem', data: { productId: 'p1' } },
      { type: 'Confirm', data: {} },
    ]);

    const span = tracer.spans.find((s) => s.name === 'command.handle');
    expect(span).toBeDefined();
    expect(span!.attributes[EmmettAttributes.command.type]).toEqual([
      'AddItem',
      'Confirm',
    ]);
  });
});
