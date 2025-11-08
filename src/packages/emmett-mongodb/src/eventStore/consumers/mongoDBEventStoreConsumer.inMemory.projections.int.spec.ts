// import {
//   assertMatches,
//   getInMemoryDatabase,
//   inMemoryProjector,
//   inMemorySingleStreamProjection,
//   type InMemoryDocumentsCollection,
//   type ReadEvent,
// } from '@event-driven-io/emmett';
// import {
//   mongoDBContainer,
//   type StartedmongoDBContainer,
// } from '@event-driven-io/emmett-testcontainers';
// import { after, before, describe, it } from 'node:test';
// import { v4 as uuid } from 'uuid';
// import type {
//   ProductItemAdded,
//   ShoppingCartConfirmed,
// } from '../../testing/shoppingCart.domain';
// import {
//   getmongoDBEventStore,
//   type mongoDBEventStore,
// } from '../mongoDBEventStore';
// import { mongoDBEventStoreConsumer } from './mongoDBEventStoreConsumer';

// const withDeadline = { timeout: 10000 };

// void describe('mongoDB event store started consumer', () => {
//   let mongoDB: StartedmongoDBContainer;
//   let connectionString: string;
//   let eventStore: mongoDBEventStore;
//   let summaries: InMemoryDocumentsCollection<ShoppingCartSummary>;
//   const productItem = { price: 10, productId: uuid(), quantity: 10 };
//   const confirmedAt = new Date();
//   const database = getInMemoryDatabase();

//   before(async () => {
//     mongoDB = await new mongoDBContainer().start();
//     connectionString = mongoDB.getConnectionString();
//     eventStore = getmongoDBEventStore(mongoDB.getClient());
//     summaries = database.collection(shoppingCartsSummaryCollectionName);
//   });

//   after(async () => {
//     try {
//       await mongoDB.stop();
//     } catch (error) {
//       console.log(error);
//     }
//   });

//   void describe('eachMessage', () => {
//     void it(
//       'handles all events appended to event store BEFORE projector was started',
//       withDeadline,
//       async () => {
//         // Given
//         const shoppingCartId = `shoppingCart:${uuid()}`;
//         const streamName = `shopping_cart-${shoppingCartId}`;
//         const events: ShoppingCartSummaryEvent[] = [
//           { type: 'ProductItemAdded', data: { productItem } },
//           { type: 'ShoppingCartConfirmed', data: { confirmedAt } },
//         ];
//         const appendResult = await eventStore.appendToStream(
//           streamName,
//           events,
//         );

//         const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
//           processorId: uuid(),
//           projection: shoppingCartsSummaryProjection,
//           connectionOptions: { database },
//           stopAfter: (event) =>
//             event.metadata.globalPosition ===
//             appendResult.lastEventGlobalPosition,
//         });

//         // When
//         const consumer =
//           mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
//             connectionString,
//             processors: [inMemoryProcessor],
//           });

//         try {
//           await consumer.start();

//           const summary = await summaries.findOne((d) => d._id === streamName);

//           assertMatches(summary, {
//             _id: streamName,
//             status: 'confirmed',
//             // TODO: ensure that _version and _id works like in Pongo
//             //_version: 2n,
//             productItemsCount: productItem.quantity,
//           });
//         } finally {
//           await consumer.close();
//         }
//       },
//     );

//     void it(
//       'handles all events appended to event store AFTER projector was started',
//       withDeadline,
//       async () => {
//         // Given
//         let stopAfterPosition: bigint | undefined = undefined;

//         const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
//           processorId: uuid(),
//           projection: shoppingCartsSummaryProjection,
//           connectionOptions: { database },
//           stopAfter: (event) =>
//             event.metadata.globalPosition === stopAfterPosition,
//         });
//         const consumer =
//           mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
//             connectionString,
//             processors: [inMemoryProcessor],
//           });

//         // When
//         const shoppingCartId = `shoppingCart:${uuid()}`;
//         const streamName = `shopping_cart-${shoppingCartId}`;
//         const events: ShoppingCartSummaryEvent[] = [
//           {
//             type: 'ProductItemAdded',
//             data: {
//               productItem,
//             },
//           },
//           {
//             type: 'ShoppingCartConfirmed',
//             data: { confirmedAt },
//           },
//         ];

//         try {
//           const consumerPromise = consumer.start();

//           const appendResult = await eventStore.appendToStream(
//             streamName,
//             events,
//           );
//           stopAfterPosition = appendResult.lastEventGlobalPosition;

//           await consumerPromise;

//           const summary = await summaries.findOne((d) => d._id === streamName);

//           assertMatches(summary, {
//             _id: streamName,
//             status: 'confirmed',
//             //_version: 2n,
//             productItemsCount: productItem.quantity,
//           });
//         } finally {
//           await consumer.close();
//         }
//       },
//     );

//     void it(
//       'handles ONLY events AFTER provided global position',
//       withDeadline,
//       async () => {
//         // Given
//         const shoppingCartId = `shoppingCart:${uuid()}`;
//         const streamName = `shopping_cart-${shoppingCartId}`;

//         const initialEvents: ShoppingCartSummaryEvent[] = [
//           { type: 'ProductItemAdded', data: { productItem } },
//           { type: 'ProductItemAdded', data: { productItem } },
//         ];
//         const { lastEventGlobalPosition: startPosition } =
//           await eventStore.appendToStream(streamName, initialEvents);

//         const events: ShoppingCartSummaryEvent[] = [
//           { type: 'ProductItemAdded', data: { productItem } },
//           {
//             type: 'ShoppingCartConfirmed',
//             data: { confirmedAt },
//           },
//         ];

//         let stopAfterPosition: bigint | undefined = undefined;

//         const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
//           processorId: uuid(),
//           projection: shoppingCartsSummaryProjection,
//           connectionOptions: { database },
//           startFrom: { lastCheckpoint: startPosition },
//           stopAfter: (event) =>
//             event.metadata.globalPosition === stopAfterPosition,
//         });

//         const consumer =
//           mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
//             connectionString,
//             processors: [inMemoryProcessor],
//           });

//         // When
//         try {
//           const consumerPromise = consumer.start();

//           const appendResult = await eventStore.appendToStream(
//             streamName,
//             events,
//           );
//           stopAfterPosition = appendResult.lastEventGlobalPosition;

//           await consumerPromise;

//           const summary = await summaries.findOne((d) => d._id === streamName);

//           assertMatches(summary, {
//             _id: streamName,
//             status: 'confirmed',
//             _version: 2n,
//             productItemsCount: productItem.quantity,
//           });
//         } finally {
//           await consumer.close();
//         }
//       },
//     );

//     void it(
//       'handles all events when CURRENT position is NOT stored',
//       withDeadline,
//       async () => {
//         // Given
//         const shoppingCartId = `shoppingCart:${uuid()}`;
//         const streamName = `shopping_cart-${shoppingCartId}`;

//         const initialEvents: ShoppingCartSummaryEvent[] = [
//           { type: 'ProductItemAdded', data: { productItem } },
//           { type: 'ProductItemAdded', data: { productItem } },
//         ];

//         await eventStore.appendToStream(streamName, initialEvents);

//         const events: ShoppingCartSummaryEvent[] = [
//           { type: 'ProductItemAdded', data: { productItem } },
//           {
//             type: 'ShoppingCartConfirmed',
//             data: { confirmedAt },
//           },
//         ];

//         let stopAfterPosition: bigint | undefined = undefined;

//         const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
//           processorId: uuid(),
//           projection: shoppingCartsSummaryProjection,
//           connectionOptions: { database },
//           startFrom: 'CURRENT',
//           stopAfter: (event) =>
//             event.metadata.globalPosition === stopAfterPosition,
//         });

//         const consumer =
//           mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
//             connectionString,
//             processors: [inMemoryProcessor],
//           });

//         // When

//         try {
//           const consumerPromise = consumer.start();

//           const appendResult = await eventStore.appendToStream(
//             streamName,
//             events,
//           );
//           stopAfterPosition = appendResult.lastEventGlobalPosition;

//           await consumerPromise;

//           const summary = await summaries.findOne((d) => d._id === streamName);

//           assertMatches(summary, {
//             _id: streamName,
//             status: 'confirmed',
//             // _version: 4n,
//             productItemsCount: productItem.quantity * 3,
//           });
//         } finally {
//           await consumer.close();
//         }
//       },
//     );

//     void it(
//       'handles only new events when CURRENT position is stored for restarted consumer',
//       withDeadline,
//       async () => {
//         // Given
//         const shoppingCartId = `shoppingCart:${uuid()}`;
//         const streamName = `shopping_cart-${shoppingCartId}`;

//         const initialEvents: ShoppingCartSummaryEvent[] = [
//           { type: 'ProductItemAdded', data: { productItem } },
//           { type: 'ProductItemAdded', data: { productItem } },
//         ];
//         const { lastEventGlobalPosition } = await eventStore.appendToStream(
//           streamName,
//           initialEvents,
//         );

//         const events: ShoppingCartSummaryEvent[] = [
//           { type: 'ProductItemAdded', data: { productItem } },
//           {
//             type: 'ShoppingCartConfirmed',
//             data: { confirmedAt },
//           },
//         ];

//         let stopAfterPosition: bigint | undefined = lastEventGlobalPosition;

//         const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
//           processorId: uuid(),
//           projection: shoppingCartsSummaryProjection,
//           connectionOptions: { database },
//           startFrom: 'CURRENT',
//           stopAfter: (event) =>
//             event.metadata.globalPosition === stopAfterPosition,
//         });

//         const consumer =
//           mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
//             connectionString,
//             processors: [inMemoryProcessor],
//           });

//         // When
//         await consumer.start();
//         await consumer.stop();

//         stopAfterPosition = undefined;

//         try {
//           const consumerPromise = consumer.start();

//           const appendResult = await eventStore.appendToStream(
//             streamName,
//             events,
//           );
//           stopAfterPosition = appendResult.lastEventGlobalPosition;

//           await consumerPromise;

//           const summary = await summaries.findOne((d) => d._id === streamName);

//           assertMatches(summary, {
//             _id: streamName,
//             status: 'confirmed',
//             //_version: 4n,
//             productItemsCount: productItem.quantity * 3,
//           });
//         } finally {
//           await consumer.close();
//         }
//       },
//     );

//     void it(
//       'handles only new events when CURRENT position is stored for a new consumer',
//       withDeadline,
//       async () => {
//         // Given
//         const shoppingCartId = `shoppingCart:${uuid()}`;
//         const streamName = `shopping_cart-${shoppingCartId}`;

//         const initialEvents: ShoppingCartSummaryEvent[] = [
//           { type: 'ProductItemAdded', data: { productItem } },
//           { type: 'ProductItemAdded', data: { productItem } },
//         ];
//         const { lastEventGlobalPosition } = await eventStore.appendToStream(
//           streamName,
//           initialEvents,
//         );

//         const events: ShoppingCartSummaryEvent[] = [
//           { type: 'ProductItemAdded', data: { productItem } },
//           {
//             type: 'ShoppingCartConfirmed',
//             data: { confirmedAt },
//           },
//         ];

//         let stopAfterPosition: bigint | undefined = lastEventGlobalPosition;

//         const inMemoryProcessor = inMemoryProjector<ShoppingCartSummaryEvent>({
//           processorId: uuid(),
//           projection: shoppingCartsSummaryProjection,
//           connectionOptions: { database },
//           startFrom: 'CURRENT',
//           stopAfter: (event) =>
//             event.metadata.globalPosition === stopAfterPosition,
//         });

//         const consumer =
//           mongoDBEventStoreConsumer<ShoppingCartSummaryEvent>({
//             connectionString,
//             processors: [inMemoryProcessor],
//           });

//         // When
//         try {
//           await consumer.start();
//         } finally {
//           await consumer.close();
//         }

//         stopAfterPosition = undefined;

//         const newConsumer = mongoDBEventStoreConsumer({
//           connectionString,
//           processors: [inMemoryProcessor],
//         });

//         try {
//           const consumerPromise = newConsumer.start();

//           const appendResult = await eventStore.appendToStream(
//             streamName,
//             events,
//           );
//           stopAfterPosition = appendResult.lastEventGlobalPosition;

//           await consumerPromise;

//           const summary = await summaries.findOne((d) => d._id === streamName);

//           assertMatches(summary, {
//             _id: streamName,
//             status: 'confirmed',
//             //_version: 4n,
//             productItemsCount: productItem.quantity * 3,
//           });
//         } finally {
//           await newConsumer.close();
//         }
//       },
//     );
//   });
// });

// type ShoppingCartSummary = {
//   _id?: string;
//   productItemsCount: number;
//   status: string;
// };

// const shoppingCartsSummaryCollectionName = 'shoppingCartsSummary';

// export type ShoppingCartSummaryEvent = ProductItemAdded | ShoppingCartConfirmed;

// const evolve = (
//   document: ShoppingCartSummary,
//   { type, data }: ReadEvent<ShoppingCartSummaryEvent>,
// ): ShoppingCartSummary => {
//   switch (type) {
//     case 'ProductItemAdded':
//       return {
//         ...document,
//         productItemsCount:
//           document.productItemsCount + data.productItem.quantity,
//       };
//     case 'ShoppingCartConfirmed':
//       return {
//         ...document,
//         status: 'confirmed',
//       };
//     default:
//       return document;
//   }
// };

// const shoppingCartsSummaryProjection = inMemorySingleStreamProjection({
//   collectionName: shoppingCartsSummaryCollectionName,
//   evolve,
//   canHandle: ['ProductItemAdded', 'ShoppingCartConfirmed'],
//   initialState: () => ({
//     status: 'pending',
//     productItemsCount: 0,
//   }),
// });
