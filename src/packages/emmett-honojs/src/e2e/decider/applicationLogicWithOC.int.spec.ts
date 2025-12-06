// import {
//   assertEqual,
//   assertFails,
//   assertMatches,
//   assertOk,
//   getInMemoryEventStore,
//   type InMemoryEventStore,
// } from '@event-driven-io/emmett';
// import type { response } from 'express';
// import type { Hono } from 'hono';
// import { randomUUID } from 'node:crypto';
// import { beforeEach, describe, it } from 'node:test';
// import { getApplication } from '../../application';
// import { HeaderNames, toWeakETag } from '../../etag';
// import { expectNextRevisionInResponseEtag } from '../testing';
// import { shoppingCartApi } from './api';
// import type { ShoppingCartEvent } from './shoppingCart';

// void describe('Application logic with optimistic concurrency', () => {
//   let app: Hono;
//   let eventStore: InMemoryEventStore;

//   beforeEach(() => {
//     eventStore = getInMemoryEventStore();
//     app = getApplication({ apis: [shoppingCartApi(eventStore)] });
//   });

//   void it('Should handle requests correctly', async () => {
//     const clientId = randomUUID();
//     ///////////////////////////////////////////////////
//     // 1. Open Shopping Cart
//     ///////////////////////////////////////////////////
//     const createResponse = await app.request(
//       `/clients/${clientId}/shopping-carts`,
//       { method: 'POST' },
//     );
//     const secondCreateResponse = await app.request(
//       `/clients/${clientId}/shopping-carts`,
//       { method: 'POST' },
//     );

//     assertEqual(createResponse.status, 201);
//     assertEqual(secondCreateResponse.status, 412);
//     let currentRevision = expectNextRevisionInResponseEtag(createResponse);
//     const current = (await createResponse.json()) as { id?: string };

//     if (!current.id) {
//       assertFails();
//     }
//     assertOk(current.id);

//     const shoppingCartId = current.id;

//     ///////////////////////////////////////////////////
//     // 2. Add Two Pair of Shoes
//     ///////////////////////////////////////////////////
//     const twoPairsOfShoes = {
//       quantity: 2,
//       productId: '123',
//     };
//     const resp1 = await app.request(
//       `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
//       {
//         method: 'POST',
//         headers: new Headers({
//           [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
//         }),
//         body: twoPairsOfShoes,
//       },
//     );
//     const resp2 = await app.request(
//       `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
//       {
//         method: 'POST',
//         headers: new Headers({
//           [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
//         }),
//         body: twoPairsOfShoes,
//       },
//     );
//     assertEqual(resp1.status, 204);
//     assertEqual(resp2.status, 412);

//     currentRevision = expectNextRevisionInResponseEtag(response);

//     ///////////////////////////////////////////////////
//     // 3. Add T-Shirt
//     ///////////////////////////////////////////////////
//     const tShirt = {
//       productId: '456',
//       quantity: 1,
//     };
//     const resp3 = await app.request(
//       `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
//       {
//         method: 'POST',
//         headers: new Headers({
//           [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
//         }),
//         body: tShirt,
//       },
//     );
//     const resp4 = await app.request(
//       `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items`,
//       {
//         method: 'POST',
//         headers: new Headers({
//           [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
//         }),
//         body: tShirt,
//       },
//     );
//     assertEqual(resp3.status, 204);
//     assertEqual(resp4.status, 412);

//     currentRevision = expectNextRevisionInResponseEtag(response);

//     ///////////////////////////////////////////////////
//     // 4. Remove pair of shoes
//     ///////////////////////////////////////////////////
//     const pairOfShoes = {
//       productId: '123',
//       quantity: 1,
//       unitPrice: 100,
//     };
//     const resp5 = await app.request(
//       `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items?productId=${pairOfShoes.productId}&quantity=${pairOfShoes.quantity}&unitPrice=${pairOfShoes.unitPrice}`,
//       {
//         method: 'DELETE',
//         headers: new Headers({
//           [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
//         }),
//       },
//     );
//     const resp6 = await app.request(
//       `/clients/${clientId}/shopping-carts/${shoppingCartId}/product-items?productId=${pairOfShoes.productId}&quantity=${pairOfShoes.quantity}&unitPrice=${pairOfShoes.unitPrice}`,
//       {
//         method: 'DELETE',
//         headers: new Headers({
//           [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
//         }),
//       },
//     );
//     assertEqual(resp5.status, 204);
//     assertEqual(resp6.status, 412);

//     currentRevision = expectNextRevisionInResponseEtag(response);

//     ///////////////////////////////////////////////////
//     // 5. Confirm cart
//     ///////////////////////////////////////////////////

//     const resp7 = await app.request(
//       `/clients/${clientId}/shopping-carts/${shoppingCartId}/confirm`,
//       {
//         method: 'POST',
//         headers: new Headers({
//           [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
//         }),
//       },
//     );
//     const resp8 = await app.request(
//       `/clients/${clientId}/shopping-carts/${shoppingCartId}/confirm`,
//       {
//         method: 'POST',
//         headers: new Headers({
//           [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
//         }),
//       },
//     );

//     currentRevision = expectNextRevisionInResponseEtag(resp7);

//     ///////////////////////////////////////////////////
//     // 6. Try Cancel Cart
//     ///////////////////////////////////////////////////

//     const resp9 = await app.request(
//       `/clients/${clientId}/shopping-carts/${shoppingCartId}`,
//       {
//         method: 'DELETE',
//         headers: new Headers({
//           [HeaderNames.IF_MATCH]: toWeakETag(currentRevision),
//         }),
//       },
//     );

//     const result =
//       await eventStore.readStream<ShoppingCartEvent>(shoppingCartId);

//     assertOk(result);
//     assertEqual(result.events.length, Number(currentRevision));

//     assertMatches(result?.events, [
//       {
//         type: 'ShoppingCartOpened',
//         data: {
//           shoppingCartId,
//           clientId,
//           //openedAt,
//         },
//       },
//       {
//         type: 'ProductItemAddedToShoppingCart',
//         data: {
//           shoppingCartId,
//           productItem: twoPairsOfShoes,
//         },
//       },
//       {
//         type: 'ProductItemAddedToShoppingCart',
//         data: {
//           shoppingCartId,
//           productItem: tShirt,
//         },
//       },
//       {
//         type: 'ProductItemRemovedFromShoppingCart',
//         data: { shoppingCartId, productItem: pairOfShoes },
//       },
//       {
//         type: 'ShoppingCartConfirmed',
//         data: {
//           shoppingCartId,
//           //confirmedAt,
//         },
//       },
//       // This should fail
//       // {
//       //   type: 'ShoppingCartCanceled',
//       //   data: {
//       //     shoppingCartId,
//       //     canceledAt,
//       //   },
//       // },
//     ]);
//   });
// });
