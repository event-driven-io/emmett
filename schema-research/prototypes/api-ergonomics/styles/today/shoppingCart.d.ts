import type { Event } from '@event-driven-io/emmett';
export type ShoppingCartEventMetadata = {
    clientId: string;
};
export type ProductItemAddedToShoppingCart = Event<'ProductItemAddedToShoppingCart', {
    shoppingCartId: string;
    clientId: string;
    productItem: PricedProductItem;
    addedAt: Date;
}, ShoppingCartEventMetadata>;
export type ProductItemRemovedFromShoppingCart = Event<'ProductItemRemovedFromShoppingCart', {
    shoppingCartId: string;
    productItem: PricedProductItem;
    removedAt: Date;
}, ShoppingCartEventMetadata>;
export type ShoppingCartConfirmed = Event<'ShoppingCartConfirmed', {
    shoppingCartId: string;
    confirmedAt: Date;
}, ShoppingCartEventMetadata>;
export type ShoppingCartCancelled = Event<'ShoppingCartCancelled', {
    shoppingCartId: string;
    cancelledAt: Date;
}, ShoppingCartEventMetadata>;
export type ShoppingCartEvent = ProductItemAddedToShoppingCart | ProductItemRemovedFromShoppingCart | ShoppingCartConfirmed | ShoppingCartCancelled;
export interface ProductItem {
    productId: string;
    quantity: number;
}
export type PricedProductItem = ProductItem & {
    unitPrice: number;
};
export type EmptyShoppingCart = {
    status: 'Empty';
};
export type OpenedShoppingCart = {
    status: 'Opened';
    productItems: ProductItems;
};
export type ClosedShoppingCart = {
    status: 'Closed';
};
export type ShoppingCart = EmptyShoppingCart | OpenedShoppingCart | ClosedShoppingCart;
export type ProductItems = Map<string, number>;
export declare const initialState: () => ShoppingCart;
export declare const evolve: (state: ShoppingCart, event: ShoppingCartEvent) => ShoppingCart;
