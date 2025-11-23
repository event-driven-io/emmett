import type { PricedProductItem, ShoppingCartEvent } from '../shoppingCart';

export type ClientShoppingSummary = {
  clientId: string;
  pending: PendingSummary | undefined;
  confirmed: ConfirmedSummary;
  cancelled: CancelledSummary;
};

export type ShoppingSummary = {
  productItemsCount: number;
  totalAmount: number;
};

export type PendingSummary = ShoppingSummary & {
  cartId: string;
};

export type ConfirmedSummary = ShoppingSummary & {
  cartsCount: number;
};

export type CancelledSummary = ShoppingSummary & {
  cartsCount: number;
};

const _evolve = (
  document: ClientShoppingSummary | null,
  { type, data: event, metadata }: ShoppingCartEvent,
): ClientShoppingSummary | null => {
  const summary: ClientShoppingSummary = document ?? {
    clientId: metadata.clientId,
    pending: undefined,
    confirmed: initialSummary,
    cancelled: initialSummary,
  };

  switch (type) {
    case 'ProductItemAddedToShoppingCart':
      return {
        ...summary,
        pending: {
          cartId: event.shoppingCartId,
          ...withAdjustedTotals({
            summary: summary.pending,
            with: event.productItem,
            by: 'adding',
          }),
        },
      };
    case 'ProductItemRemovedFromShoppingCart':
      return {
        ...summary,
        pending: {
          cartId: event.shoppingCartId,
          ...withAdjustedTotals({
            summary: summary.pending,
            with: event.productItem,
            by: 'removing',
          }),
        },
      };
    case 'ShoppingCartConfirmed':
      return {
        ...summary,
        pending: undefined,
        confirmed: {
          cartsCount: summary.confirmed.cartsCount + 1,
          ...withAdjustedTotals({
            summary: summary.confirmed,
            with: summary.pending!,
            by: 'adding',
          }),
        },
      };
    case 'ShoppingCartCancelled':
      return {
        ...summary,
        pending: undefined,
        cancelled: {
          cartsCount: summary.confirmed.cartsCount + 1,
          ...withAdjustedTotals({
            summary: summary.confirmed,
            with: summary.pending!,
            by: 'adding',
          }),
        },
      };
    default:
      return summary;
  }
};

const initialSummary = {
  cartsCount: 0,
  productItemsCount: 0,
  totalAmount: 0,
};

const withAdjustedTotals = (options: {
  summary: ShoppingSummary | undefined;
  with: PricedProductItem | ShoppingSummary;
  by: 'adding' | 'removing';
}) => {
  const { summary: document, by } = options;

  const totalAmount =
    'totalAmount' in options.with
      ? options.with.totalAmount
      : options.with.unitPrice * options.with.quantity;
  const productItemsCount =
    'productItemsCount' in options.with
      ? options.with.productItemsCount
      : options.with.quantity;

  const plusOrMinus = by === 'adding' ? 1 : -1;

  return {
    ...document,
    totalAmount: (document?.totalAmount ?? 0) + totalAmount * plusOrMinus,
    productItemsCount:
      (document?.productItemsCount ?? 0) + productItemsCount * plusOrMinus,
  };
};

const _clientShoppingSummaryCollectionName = 'ClientShoppingSummary';

// export const getClientShoppingSummary = (
//   db: SQLiteConnection,
//   clientId: string,
// ): Promise<ClientShoppingSummary | null> =>
//   db
//     .collection<ClientShoppingSummary>(clientShoppingSummaryCollectionName)
//     .findOne({ _id: clientId });

// export const clientShoppingSummaryProjection = pongoMultiStreamProjection({
//   collectionName: clientShoppingSummaryCollectionName,
//   getDocumentId: (event) => event.metadata.clientId,
//   evolve,
//   canHandle: [
//     'ProductItemAddedToShoppingCart',
//     'ProductItemRemovedFromShoppingCart',
//     'ShoppingCartConfirmed',
//     'ShoppingCartCancelled',
//   ],
// });
