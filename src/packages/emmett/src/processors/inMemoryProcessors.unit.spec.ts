import { describe, expectTypeOf, it } from 'vitest';
import { v7 as uuid } from 'uuid';
import { consumer } from '../consumers/consumers';
import { inMemoryMessageSource } from '../consumers/inMemoryMessageSource';
import { EmmettError } from '../errors';
import type {
  EventStore,
  InMemoryProjectorFactory,
  InMemoryReactorFactory,
  InMemoryWorkflowProcessorFactory,
} from '../eventStore';
import { assertRejects } from '../testing';
import type { Event, ReadEventMetadataWithGlobalPosition } from '../typing';
import {
  inMemoryProjector,
  inMemoryReactor,
  inMemoryWorkflowProcessor,
  type InMemoryProcessorHandlerContext,
} from './inMemoryProcessors';

type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string; quantity: number } }
>;

const isMissingMessageStoreError = (error: Error) =>
  error instanceof EmmettError && error.message.includes('message store');

void describe('in-memory processor handler context', () => {
  void it('requires the message store in the session', () => {
    expectTypeOf<
      InMemoryProcessorHandlerContext['session']['messageStore']
    >().toEqualTypeOf<EventStore>();
  });
});

void describe('in-memory processor without a message store', () => {
  void it('fails to start on the generic consumer without a scope', async () => {
    const messageConsumer = consumer<
      ProductItemAdded,
      ReadEventMetadataWithGlobalPosition,
      InMemoryProcessorHandlerContext,
      InMemoryReactorFactory<ProductItemAdded>,
      InMemoryProjectorFactory<ProductItemAdded>,
      InMemoryWorkflowProcessorFactory<ProductItemAdded>
    >({
      source: inMemoryMessageSource<
        ProductItemAdded,
        ReadEventMetadataWithGlobalPosition
      >(),
      reactorFactory: inMemoryReactor,
      projectorFactory: inMemoryProjector,
      workflowProcessorFactory: inMemoryWorkflowProcessor,
      until: { noMessagesLeft: true },
    });

    messageConsumer.reactor({
      processorId: uuid(),
      eachMessage: () => {},
    });

    await assertRejects(messageConsumer.start(), isMissingMessageStoreError);
    await assertRejects(
      messageConsumer.whenStarted(),
      isMissingMessageStoreError,
    );

    await messageConsumer.close();
  });
});
