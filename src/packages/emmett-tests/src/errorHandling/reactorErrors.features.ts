import {
  assertDeepEqual,
  assertEqual,
  assertMatches,
  type AnyMessage,
  type Event,
  type EventStore,
  type MessageConsumer,
  type ReactorOptions,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { v4 as uuid } from 'uuid';
import { afterEach, beforeEach, describe, it } from 'vitest';

export type OrderPlaced = Event<
  'OrderPlaced',
  { orderId: string; amount: number }
>;
export type PaymentCharged = Event<
  'PaymentCharged',
  { orderId: string; amount: number }
>;
export type PaymentFailed = Event<
  'PaymentFailed',
  { orderId: string; amount: number; reason: string }
>;

export type PaymentEvent = OrderPlaced | PaymentCharged | PaymentFailed;

export type ReactorConsumer = MessageConsumer & {
  reactor: <MessageType extends AnyMessage>(
    options: ReactorOptions<MessageType>,
  ) => unknown;
};

export type ConsumerTestContext = {
  eventStore: EventStore;
  consumer: ReactorConsumer;
  teardown?: () => Promise<void>;
};

export type ConsumerFactory = () => Promise<ConsumerTestContext>;

let eventStore: EventStore;
let consumer: ReactorConsumer;

export class PaymentDeclinedError extends Error {
  constructor(public readonly reason: string) {
    super(`Payment declined: ${reason}`);
  }
}

const declinedAmount = 999;

const charged: string[] = [];

const chargeGateway = (orderId: string, amount: number): Promise<void> => {
  if (amount === declinedAmount)
    return Promise.reject(new PaymentDeclinedError('InsufficientFunds'));

  charged.push(orderId);
  return Promise.resolve();
};

// #region failure-as-event
const registerRecordingReactor = () =>
  consumer.reactor<OrderPlaced>({
    processorId: 'payments',
    canHandle: ['OrderPlaced'],
    eachMessage: async ({ data: { orderId, amount } }) => {
      let payment: PaymentCharged | PaymentFailed;

      try {
        await chargeGateway(orderId, amount);
        payment = { type: 'PaymentCharged', data: { orderId, amount } };
      } catch (error) {
        // the gateway declining is an outcome the business expects, so record
        // it as an event; throwing here would stop the reactor instead
        payment = {
          type: 'PaymentFailed',
          data: {
            orderId,
            amount,
            reason:
              error instanceof PaymentDeclinedError
                ? error.reason
                : 'GatewayUnavailable',
          },
        };
      }

      await eventStore.appendToStream(`payment-${orderId}`, [payment]);
    },
  });
// #endregion failure-as-event

// #region reactor-skip-stop
import { EmmettError, MessageProcessor } from '@event-driven-io/emmett';

const { skip, stop } = MessageProcessor.result;

const registerChargingReactor = () =>
  consumer.reactor<OrderPlaced>({
    processorId: 'payments',
    canHandle: ['OrderPlaced'],
    eachMessage: async ({ data: { orderId, amount } }) => {
      // a free order has nothing to charge: skipping moves the checkpoint past
      // the message and lets the reactor carry on
      if (amount === 0) return skip({ reason: 'free order' });

      try {
        await chargeGateway(orderId, amount);
      } catch (error) {
        // charging sits on the critical revenue path, so a lost charge must not
        // be skipped: stop, and resume here once the cause is fixed
        return stop({
          reason:
            error instanceof PaymentDeclinedError
              ? error.reason
              : 'GatewayUnavailable',
          error: new EmmettError('payment charge failed'),
        });
      }
    },
  });
// #endregion reactor-skip-stop

const paymentStream = (orderId: string) => `payment-${orderId}`;

const appendOrder = (orderId: string, amount: number) =>
  eventStore.appendToStream<OrderPlaced>(`order-${orderId}`, [
    { type: 'OrderPlaced', data: { orderId, amount } },
  ]);

const stoppingAfterOrder = (
  source: ReactorConsumer,
  lastOrderId: string,
): ReactorConsumer => ({
  ...source,
  reactor: (options) =>
    source.reactor({
      ...options,
      stopAfter: (message) => {
        const order = message as RecordedMessage<OrderPlaced>;
        return (
          order.type === 'OrderPlaced' && order.data.orderId === lastOrderId
        );
      },
    }),
});

const setupStore = (consumerFactory: ConsumerFactory) => {
  let teardown: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    const context = await consumerFactory();
    eventStore = context.eventStore;
    consumer = context.consumer;
    teardown = context.teardown;
    charged.length = 0;
  });

  afterEach(async () => {
    if (teardown) await teardown();
  });
};

export function testReactorRecordsFailureAsEvent(
  consumerFactory: ConsumerFactory,
) {
  describe('reactor recording a failure as an event', () => {
    setupStore(consumerFactory);

    it('records the decline as an event and carries on to the next order', async () => {
      const declinedOrderId = uuid();
      const chargedOrderId = uuid();

      await appendOrder(declinedOrderId, declinedAmount);
      await appendOrder(chargedOrderId, 100);

      consumer = stoppingAfterOrder(consumer, chargedOrderId);
      registerRecordingReactor();

      try {
        await consumer.start();

        const declined = await eventStore.readStream<PaymentEvent>(
          paymentStream(declinedOrderId),
        );
        const succeeded = await eventStore.readStream<PaymentEvent>(
          paymentStream(chargedOrderId),
        );

        assertEqual(declined.events?.length, 1);
        assertMatches(declined.events[0], {
          type: 'PaymentFailed',
          data: {
            orderId: declinedOrderId,
            amount: declinedAmount,
            reason: 'InsufficientFunds',
          },
        });

        assertEqual(succeeded.events?.length, 1);
        assertMatches(succeeded.events[0], {
          type: 'PaymentCharged',
          data: { orderId: chargedOrderId, amount: 100 },
        });
      } finally {
        await consumer.close();
      }
    });
  });
}

export function testReactorSkipsAndStops(consumerFactory: ConsumerFactory) {
  describe('reactor skipping and stopping', () => {
    setupStore(consumerFactory);

    it('skips a message with nothing to do and keeps processing', async () => {
      const freeOrderId = uuid();
      const paidOrderId = uuid();

      await appendOrder(freeOrderId, 0);
      await appendOrder(paidOrderId, 100);

      consumer = stoppingAfterOrder(consumer, paidOrderId);
      registerChargingReactor();

      try {
        await consumer.start();

        assertDeepEqual(charged, [paidOrderId]);
      } finally {
        await consumer.close();
      }
    });

    it('stops the reactor when the critical path fails', async () => {
      const firstOrderId = uuid();
      const declinedOrderId = uuid();
      const laterOrderId = uuid();

      await appendOrder(firstOrderId, 50);
      await appendOrder(declinedOrderId, declinedAmount);
      await appendOrder(laterOrderId, 100);

      consumer = stoppingAfterOrder(consumer, laterOrderId);
      registerChargingReactor();

      try {
        await consumer.start();

        assertDeepEqual(charged, [firstOrderId]);
      } finally {
        await consumer.close();
      }
    });
  });
}
