import { describe, expectTypeOf, it } from 'vitest';
import type { Command } from '../typing';
import type { Workflow } from './workflow';

type TimeOutPayment = Command<'TimeOutPayment', { paymentId: string }>;
type CancelPayment = Command<'CancelPayment', { paymentId: string }>;

void describe('Workflow', () => {
  void it('accepts a workflow that sends messages of other types than it receives', () => {
    const paymentTimeout = {
      name: 'PaymentTimeout',
      initialState: () => ({}),
      evolve: (state: object) => state,
      decide: ({ data }: TimeOutPayment): CancelPayment[] => [
        { type: 'CancelPayment', data },
      ],
    };

    expectTypeOf(paymentTimeout).toExtend<
      Workflow<TimeOutPayment, object, CancelPayment>
    >();
  });

  void it('rejects a workflow that sends a message of the type it receives', () => {
    const paymentTimeout = {
      name: 'PaymentTimeout',
      initialState: () => ({}),
      evolve: (state: object) => state,
      decide: ({ data }: TimeOutPayment): TimeOutPayment[] => [
        { type: 'TimeOutPayment', data },
      ],
    };

    expectTypeOf(paymentTimeout).not.toExtend<
      Workflow<TimeOutPayment, object, TimeOutPayment>
    >();
  });
});
