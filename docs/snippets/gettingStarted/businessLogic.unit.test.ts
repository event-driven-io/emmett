// import { v4 as uuid } from 'uuid';
// import { ShoppingCartErrors, decider } from './shoppingCart';

// // #region getting-started-state-default
// import { DeciderSpecification } from '@event-driven-io/emmett/dist/testing/deciderSpecification';

// describe('ShoppingCart', () => {
//   describe('When not initialised', () => {
//     it('should open a new one', () => {
//       given([])
//         .when({
//           type: 'OpenShoppingCart',
//           data: {
//             shoppingCartId,
//             clientId,
//             now,
//           },
//         })
//         .then([
//           {
//             type: 'ShoppingCartOpened',
//             data: {
//               shoppingCartId,
//               clientId,
//               openedAt: now.toJSON(),
//             },
//           },
//         ]);
//     });
//   });

//   describe('When opened', () => {
//     it('should not allow to reopen', () => {
//       given({
//         type: 'ShoppingCartOpened',
//         data: {
//           shoppingCartId,
//           clientId,
//           openedAt: now.toJSON(),
//         },
//       })
//         .when({
//           type: 'OpenShoppingCart',
//           data: {
//             shoppingCartId,
//             clientId,
//             now,
//           },
//         })
//         .thenThrows(
//           (error: unknown) => error === ShoppingCartErrors.CART_ALREADY_EXISTS,
//         );
//     });
//   });

//   it('should add product to empty cart', () => {
//     given({
//       type: 'ShoppingCartOpened',
//       data: {
//         shoppingCartId,
//         clientId,
//         openedAt: now.toJSON(),
//       },
//     })
//       .when({
//         type: 'AddProductItemToShoppingCart',
//         data: {
//           shoppingCartId,
//           productItem,
//         },
//       })
//       .then({
//         type: 'ProductItemAddedToShoppingCart',
//         data: { shoppingCartId, productItem },
//       });
//   });

//   const getRandomProduct = () => {
//     return {
//       productId: uuid(),
//       price: Math.random(),
//       quantity: Math.random(),
//     };
//   };

//   const now = new Date();
//   const given = CommandHandlerSpecification.for(decider);
//   const shoppingCartId = uuid();
//   const clientId = uuid();

//   const productItem = getRandomProduct();
// });
