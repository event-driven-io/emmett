import type { ReadEvent } from '@event-driven-io/emmett';
import {
  pongoMultiStreamProjection,
  type SQLiteReadEventMetadata,
} from '@event-driven-io/emmett-sqlite';
import { clientShoppingCartsCollection } from '../../pongo.config';
import type { ShoppingCartEvent } from '../shoppingCart';

export type ClientShoppingCarts = {
  clientId: string;
  lastCartNumber: number;
  lastShoppingCartId: string;
  status: 'Opened' | 'Closed';
};

export const evolve = (
  document: ClientShoppingCarts | null,
  {
    type,
    data,
    metadata,
  }: ReadEvent<ShoppingCartEvent, SQLiteReadEventMetadata>,
): ClientShoppingCarts | null => {
  switch (type) {
    case 'ShoppingCartOpened':
      return {
        clientId: metadata.clientId,
        lastCartNumber: (document?.lastCartNumber ?? 0) + 1,
        lastShoppingCartId: data.shoppingCartId,
        status: 'Opened',
      };
    case 'ShoppingCartConfirmed':
    case 'ShoppingCartCancelled':
      return document && { ...document, status: 'Closed' };
    default:
      return document;
  }
};

export const clientShoppingCartsProjection = pongoMultiStreamProjection({
  collectionName: clientShoppingCartsCollection.tableName,
  collectionOptions: { definition: clientShoppingCartsCollection },
  getDocumentId: (event: ReadEvent<ShoppingCartEvent>) =>
    event.metadata.clientId,
  evolve,
  canHandle: [
    'ShoppingCartOpened',
    'ShoppingCartConfirmed',
    'ShoppingCartCancelled',
  ],
});
