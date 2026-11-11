import { describe, it } from 'vitest';
import { assertDeepEqual } from '../../testing';
import type { Event, RecordedMessage } from '../../typing';
import { upcastRecordedMessage } from './upcasting';

// #region event-schema-version-types
type ProductItemAddedV1 = Event<'ProductItemAdded', { productId: string }>;

type ProductItemAddedV2 = Event<
  'ProductItemAdded',
  { productItem: { productId: string } },
  undefined,
  2
>;
// #endregion event-schema-version-types

type UnversionedProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: { productId: string } }
>;

const metadata = {
  streamName: 'cart-1',
  streamPosition: 1n,
  messageId: 'message-1',
  tenantId: 'acme',
};

const storedVersion1: RecordedMessage<ProductItemAddedV1> = {
  type: 'ProductItemAdded',
  data: { productId: 'shoes' },
  kind: 'Event',
  schemaVersion: 1,
  metadata,
};

const storedVersion2: RecordedMessage<ProductItemAddedV2> = {
  type: 'ProductItemAdded',
  data: { productItem: { productId: 'shoes' } },
  kind: 'Event',
  schemaVersion: 2,
  metadata,
};

describe('Upcasting schema version', () => {
  it('takes the schema version returned by the upcaster', () => {
    // #region upcast-to-schema-version
    const upcast = (event: ProductItemAddedV1): ProductItemAddedV2 => ({
      type: 'ProductItemAdded',
      data: { productItem: { productId: event.data.productId } },
      schemaVersion: 2,
    });
    // #endregion upcast-to-schema-version

    const result = upcastRecordedMessage(storedVersion1, { upcast });

    assertDeepEqual(result, {
      type: 'ProductItemAdded',
      data: { productItem: { productId: 'shoes' } },
      kind: 'Event',
      schemaVersion: 2,
      metadata,
    });
  });

  it('sets version 1 when the upcaster returns only type and data', () => {
    // #region upcast-without-schema-version
    const upcast = (
      event: ProductItemAddedV1,
    ): UnversionedProductItemAdded => ({
      type: 'ProductItemAdded',
      data: { productItem: { productId: event.data.productId } },
    });
    // #endregion upcast-without-schema-version

    const result = upcastRecordedMessage(storedVersion1, { upcast });

    assertDeepEqual(result, {
      type: 'ProductItemAdded',
      data: { productItem: { productId: 'shoes' } },
      kind: 'Event',
      schemaVersion: 1,
      metadata,
    });
  });

  it('keeps the stored version when the upcaster returns the message unchanged', () => {
    const upcast = (event: ProductItemAddedV2): ProductItemAddedV2 => event;

    const result = upcastRecordedMessage(storedVersion2, { upcast });

    assertDeepEqual(result, storedVersion2);
  });
});
