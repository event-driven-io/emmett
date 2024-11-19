import { type ReadEvent } from '@event-driven-io/emmett/src';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { after, before, beforeEach, describe, it } from 'node:test';
import { v4 as uuid } from 'uuid';
import {
  documentExists,
  pongoSingleStreamProjection,
  PostgreSQLProjectionSpec,
} from '.';
import {
  type DiscountApplied,
  type ProductItemAdded,
} from '../../testing/shoppingCart.domain';

void describe('Postgres Projections', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let given: PostgreSQLProjectionSpec<ProductItemAdded | DiscountApplied>;
  let shoppingCartId: string;
  const now = new Date();

  before(async () => {
    postgres = await new PostgreSqlContainer().start();
    connectionString = postgres.getConnectionUri();

    given = PostgreSQLProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connectionString,
    });
  });

  beforeEach(() => (shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`));

  after(async () => {
    try {
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('with empty given and raw when', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
            addedAt: now,
          },
          metadata: {
            streamName: shoppingCartId,
          },
        },
      ])
      .then(
        documentExists<ShoppingCartShortInfo>(
          {
            openedAt: now,
            productItemsCount: 100,
            totalAmount: 10000,
            appliedDiscounts: [],
          },
          {
            inCollection: shoppingCartShortInfoCollectionName,
            withId: shoppingCartId,
          },
        ),
      ));

  // void it('with empty given and when eventsInStream', () =>
  //   given([])
  //     .when([
  //       eventInStream(shoppingCartId, {
  //         type: 'ProductItemAdded',
  //         data: {
  //           productItem: { price: 100, productId: 'shoes', quantity: 100 },
  //           addedAt: now,
  //         },
  //       }),
  //     ])
  //     .then(
  //       expectPongoDocuments
  //         .fromCollection<ShoppingCartShortInfo>(
  //           shoppingCartShortInfoCollectionName,
  //         )
  //         .withId(shoppingCartId)
  //         .toBeEqual({
  //           openedAt: now,
  //           productItemsCount: 100,
  //           totalAmount: 10000,
  //           appliedDiscounts: [],
  //         }),
  //     ));

  // void it('with empty given and when eventsInStream', () => {
  //   const couponId = uuid();

  //   return given(
  //     eventsInStream<ProductItemAdded>(shoppingCartId, [
  //       {
  //         type: 'ProductItemAdded',
  //         data: {
  //           productItem: { price: 100, productId: 'shoes', quantity: 100 },
  //           addedAt: now,
  //         },
  //       },
  //     ]),
  //   )
  //     .when(
  //       newEventsInStream(shoppingCartId, [
  //         {
  //           type: 'DiscountApplied',
  //           data: { percent: 10, couponId },
  //         },
  //       ]),
  //     )
  //     .then(
  //       expectPongoDocuments
  //         .fromCollection<ShoppingCartShortInfo>(
  //           shoppingCartShortInfoCollectionName,
  //         )
  //         .withId(shoppingCartId)
  //         .toBeEqual({
  //           openedAt: now,
  //           productItemsCount: 100,
  //           totalAmount: 9000,
  //           appliedDiscounts: [couponId],
  //         }),
  //     );
  // });

  // void it('with idempotency check', () => {
  //   const couponId = uuid();

  //   return given(
  //     eventsInStream<ProductItemAdded>(shoppingCartId, [
  //       {
  //         type: 'ProductItemAdded',
  //         data: {
  //           productItem: { price: 100, productId: 'shoes', quantity: 100 },
  //           addedAt: now,
  //         },
  //       },
  //     ]),
  //   )
  //     .when(
  //       newEventsInStream(shoppingCartId, [
  //         {
  //           type: 'DiscountApplied',
  //           data: { percent: 10, couponId },
  //         },
  //       ]),
  //       { numberOfTimes: 2 },
  //     )
  //     .then(
  //       expectPongoDocuments
  //         .fromCollection<ShoppingCartShortInfo>(
  //           shoppingCartShortInfoCollectionName,
  //         )
  //         .withId(shoppingCartId)
  //         .toBeEqual({
  //           openedAt: now,
  //           productItemsCount: 100,
  //           totalAmount: 9000,
  //           appliedDiscounts: [couponId],
  //         }),
  //     );
  // });
});

type ShoppingCartShortInfo = {
  openedAt: Date;
  productItemsCount: number;
  totalAmount: number;
  appliedDiscounts: string[];
};

const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';

const evolve = (
  document: ShoppingCartShortInfo,
  { type, data: event }: ReadEvent<ProductItemAdded | DiscountApplied>,
): ShoppingCartShortInfo => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        openedAt: document.openedAt ?? event.addedAt,
        totalAmount:
          document.totalAmount +
          event.productItem.price * event.productItem.quantity,
        productItemsCount:
          document.productItemsCount + event.productItem.quantity,
      };
    case 'DiscountApplied':
      // idempotence check
      if (document.appliedDiscounts.includes(event.couponId)) return document;

      return {
        ...document,
        totalAmount: (document.totalAmount * (100 - event.percent)) / 100,
        appliedDiscounts: [...document.appliedDiscounts, event.couponId],
      };
    default:
      return document;
  }
};

const shoppingCartShortInfoProjection = pongoSingleStreamProjection({
  collectionName: shoppingCartShortInfoCollectionName,
  evolve,
  canHandle: ['ProductItemAdded', 'DiscountApplied'],
  initialState: () => ({
    openedAt: undefined!,
    productItemsCount: 0,
    totalAmount: 0,
    appliedDiscounts: [],
  }),
});
