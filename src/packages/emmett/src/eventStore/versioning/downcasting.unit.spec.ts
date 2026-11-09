import { describe, it } from 'vitest';
import { assertDeepEqual } from '../../testing';
import type { Event, RecordedMessage } from '../../typing';
import { downcastRecordedMessage } from './downcasting';

type ProductItemAddedV1 = Event<'ProductItemAdded', { productId: string }>;

type ProductItemAddedV2 = Event<
  'ProductItemAdded',
  { productItem: { productId: string } },
  undefined,
  2
>;

const metadata = {
  streamName: 'cart-1',
  streamPosition: 1n,
  messageId: 'message-1',
  tenantId: 'acme',
};

const version2: RecordedMessage<ProductItemAddedV2> = {
  type: 'ProductItemAdded',
  data: { productItem: { productId: 'shoes' } },
  kind: 'Event',
  schemaVersion: 2,
  metadata,
};

describe('Downcasting schema version', () => {
  it('takes the schema version returned by the downcaster', () => {
    const downcast = (event: ProductItemAddedV2): ProductItemAddedV1 => ({
      type: 'ProductItemAdded',
      data: { productId: event.data.productItem.productId },
      schemaVersion: 1,
    });

    const result = downcastRecordedMessage(version2, { downcast });

    assertDeepEqual(result, {
      type: 'ProductItemAdded',
      data: { productId: 'shoes' },
      kind: 'Event',
      schemaVersion: 1,
      metadata,
    });
  });

  it('sets version 1 when the downcaster returns only type and data', () => {
    const downcast = (event: ProductItemAddedV2): ProductItemAddedV1 => ({
      type: 'ProductItemAdded',
      data: { productId: event.data.productItem.productId },
    });

    const result = downcastRecordedMessage(version2, { downcast });

    assertDeepEqual(result, {
      type: 'ProductItemAdded',
      data: { productId: 'shoes' },
      kind: 'Event',
      schemaVersion: 1,
      metadata,
    });
  });

  it('keeps the version when the downcaster returns the message unchanged', () => {
    const downcast = (event: ProductItemAddedV2): ProductItemAddedV2 => event;

    const result = downcastRecordedMessage(version2, { downcast });

    assertDeepEqual(result, version2);
  });
});
