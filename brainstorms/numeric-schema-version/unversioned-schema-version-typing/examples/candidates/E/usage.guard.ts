import type { Event } from './typing';
import { isSchemaVersion } from './typing';

type ProductItem = { productId: string; quantity: number };

type ProductItemAddedV1 = Event<'ProductItemAdded', { productId: string }>;
type ProductItemAddedV2 = Event<
  'ProductItemAdded',
  { productItem: ProductItem },
  undefined,
  2
>;

export const upcast = (
  event: ProductItemAddedV1 | ProductItemAddedV2,
): ProductItemAddedV2 =>
  isSchemaVersion(event, 2)
    ? event
    : {
        type: 'ProductItemAdded',
        data: { productItem: { productId: event.data.productId, quantity: 1 } },
        schemaVersion: 2,
      };
