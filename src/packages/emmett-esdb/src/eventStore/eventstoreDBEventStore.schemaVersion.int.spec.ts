import {
  event,
  reactor,
  type Event,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { jsonEvent, type EventStoreDBClient } from '@eventstore/db-client';
import { v4 as uuid } from 'uuid';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PricedProductItem } from '../testing/shoppingCart.domain';
import { getSharedEventStoreDB } from '../testing/sharedEventStoreDB';
import {
  getEventStoreDBEventStore,
  type EventStoreDBEventStore,
} from './eventstoreDBEventStore';

type ProductItemAddedV2 = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem; currency: string },
  undefined,
  2
>;

void describe('EventStoreDBEventStore schema version', () => {
  let client: EventStoreDBClient;
  let eventStore: EventStoreDBEventStore;

  const productItem: PricedProductItem = {
    productId: '123',
    quantity: 10,
    price: 3,
  };

  beforeAll(() => {
    client = getSharedEventStoreDB().getClient();
    eventStore = getEventStoreDBEventStore(client);
  });

  const appendEventAs_0_43_0_rc_2 = async (
    streamName: string,
    metadata_0_43_0_rc_2: Record<string, unknown>,
  ) => {
    await client.appendToStream(
      streamName,
      jsonEvent({
        type: 'ProductItemAdded',
        data: { productItem },
        metadata: { messageId: 'legacy-message-1', ...metadata_0_43_0_rc_2 },
      }),
    );
  };

  const consumeEventAppendedAs_0_43_0_rc_2 = async (
    streamName: string,
    append: () => Promise<void>,
  ): Promise<RecordedMessage<Event>[]> => {
    const consumer = eventStore.consumer<Event>();
    const received: RecordedMessage<Event>[] = [];

    consumer.reactor(
      reactor<Event>({
        processorId: uuid(),
        checkpoints: 'DISABLED',
        eachMessage: (message) => {
          if (message.metadata.streamName === streamName)
            received.push(message);
        },
      }),
    );

    const consumerPromise = consumer.start();
    try {
      await consumer.whenStarted();
      await append();
      await consumer.whenCaughtUp();
    } finally {
      await consumer.close();
      await consumerPromise;
    }

    return received;
  };

  const cases_0_43_0_rc_2 = [
    {
      name: "reads version 2 for an event 0.43.0-rc.2 appended with metadata schemaVersion '2'",
      metadata_0_43_0_rc_2: { schemaVersion: '2', tenantId: 'acme' },
      schemaVersion: 2,
    },
    {
      name: 'reads version 1 for an event 0.43.0-rc.2 appended without a version',
      metadata_0_43_0_rc_2: { tenantId: 'acme' },
      schemaVersion: 1,
    },
    {
      name: "reads version 1 for an event 0.43.0-rc.2 appended with metadata schemaVersion 'v2'",
      metadata_0_43_0_rc_2: { schemaVersion: 'v2', tenantId: 'acme' },
      schemaVersion: 1,
    },
  ];

  void it('stores the schema version and kind in the event metadata', async () => {
    const streamName = `shopping_cart-${uuid()}`;

    await eventStore.appendToStream(streamName, [
      event<ProductItemAddedV2>(
        'ProductItemAdded',
        { productItem, currency: 'USD' },
        2,
      ),
    ]);

    const rawEvents = [];
    for await (const resolvedEvent of client.readStream(streamName))
      rawEvents.push(resolvedEvent.event);

    expect(rawEvents).toEqual([
      expect.objectContaining({
        type: 'ProductItemAdded',
        data: { productItem, currency: 'USD' },
        metadata: {
          messageId: expect.any(String) as unknown,
          correlationId: expect.any(String) as unknown,
          causationId: expect.any(String) as unknown,
          traceId: expect.any(String) as unknown,
          spanId: expect.any(String) as unknown,
          kind: 'Event',
          schemaVersion: 2,
        },
      }),
    ]);
  });

  void it('reads kind Event for an event 0.43.0-rc.2 appended without a kind', async () => {
    const streamName = `shopping_cart-${uuid()}`;
    await appendEventAs_0_43_0_rc_2(streamName, { tenantId: 'acme' });

    const { events } = await eventStore.readStream(streamName);

    expect(events.map((message) => message.kind)).toEqual(['Event']);
  });

  void describe.each(cases_0_43_0_rc_2)(
    '$name',
    ({ metadata_0_43_0_rc_2, schemaVersion }) => {
      void it('through readStream', async () => {
        const streamName = `shopping_cart-${uuid()}`;
        await appendEventAs_0_43_0_rc_2(streamName, metadata_0_43_0_rc_2);

        const { events } = await eventStore.readStream(streamName);

        expect(events).toEqual([
          {
            type: 'ProductItemAdded',
            data: { productItem },
            kind: 'Event',
            schemaVersion,
            metadata: {
              messageId: 'legacy-message-1',
              tenantId: 'acme',
              eventId: expect.any(String) as unknown,
              streamName,
              streamPosition: 0n,
              globalPosition: expect.any(String) as unknown,
              checkpoint: expect.any(String) as unknown,
            },
          },
        ]);
        expect(events[0]!.metadata).not.toHaveProperty('schemaVersion');
      });

      void it('through a consumer', async () => {
        const streamName = `shopping_cart-${uuid()}`;

        const received = await consumeEventAppendedAs_0_43_0_rc_2(
          streamName,
          () => appendEventAs_0_43_0_rc_2(streamName, metadata_0_43_0_rc_2),
        );

        expect(received).toEqual([
          {
            type: 'ProductItemAdded',
            data: { productItem },
            kind: 'Event',
            schemaVersion,
            metadata: {
              messageId: 'legacy-message-1',
              tenantId: 'acme',
              eventId: expect.any(String) as unknown,
              streamName,
              streamPosition: 0n,
              globalPosition: expect.any(String) as unknown,
              checkpoint: expect.any(String) as unknown,
            },
          },
        ]);
        expect(received[0]!.metadata).not.toHaveProperty('schemaVersion');
      });
    },
  );
});
