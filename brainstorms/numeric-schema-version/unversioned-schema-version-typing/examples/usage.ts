import type { Command, Event } from './typing';

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
): ProductItemAddedV2 => {
  switch (event.schemaVersion) {
    case 2:
      return event;
    default:
      return {
        type: 'ProductItemAdded',
        data: { productItem: { productId: event.data.productId, quantity: 1 } },
        schemaVersion: 2,
      };
  }
};

type AddProductItemV1 = Command<'AddProductItem', { productId: string }>;
type AddProductItemV3 = Command<
  'AddProductItem',
  { productItem: ProductItem },
  undefined,
  3
>;

export const upcastCommand = (
  command: AddProductItemV1 | AddProductItemV3,
): AddProductItemV3 => {
  switch (command.schemaVersion) {
    case 3:
      return command;
    default:
      return {
        type: 'AddProductItem',
        data: {
          productItem: { productId: command.data.productId, quantity: 1 },
        },
        schemaVersion: 3,
      };
  }
};
