import type { D1Database } from '@cloudflare/workers-types';
import { Miniflare } from 'miniflare';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { d1EventStoreDriver } from '../../..';
import type {
  DiscountApplied,
  ProductItemAdded,
} from '../../../../../testing/shoppingCart.domain';
import {
  eventInStream,
  eventsInStream,
  newEventsInStream,
  SQLiteProjectionSpec,
} from '../../../../../eventStore/projections/sqliteProjectionSpec';
import { pongoSingleStreamProjection } from '../../../../../eventStore/projections/pongo/pongoProjections';
import {
  documentExists,
  expectPongoDocuments,
} from '../../../../../eventStore/projections/pongo/pongoProjectionSpec';

void describe('Postgres Projections', () => {
  let given: SQLiteProjectionSpec<ProductItemAdded | DiscountApplied>;
  let shoppingCartId: string;
  let mf: Miniflare;
  let database: D1Database;

  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } }',
      d1Databases: { DB: 'test-db-id' },
    });
    database = await mf.getD1Database('DB');
    given = SQLiteProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      driver: d1EventStoreDriver,
      database,
    });
  });

  afterAll(async () => {
    await mf.dispose();
  });

  beforeEach(() => (shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`));

  void it('with empty given and raw when', () =>
    given([])
      .when([
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
          metadata: {
            streamName: shoppingCartId,
          },
        },
      ])
      .then(
        documentExists<ShoppingCartShortInfo>(
          {
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

  void it('with empty given and when eventsInStream', () =>
    given([])
      .when([
        eventInStream(shoppingCartId, {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        }),
      ])
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId(shoppingCartId)
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 10000,
            appliedDiscounts: [],
          }),
      ));

  void it('with empty given and when eventsInStream', () => {
    const couponId = uuid();

    return given(
      eventsInStream<ProductItemAdded>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'DiscountApplied',
            data: { percent: 10, couponId },
          },
        ]),
      )
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId(shoppingCartId)
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 9000,
            appliedDiscounts: [couponId],
          }),
      );
  });

  void it('notToExist returns success when document does not exist', () =>
    given([])
      .when([])
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId('non-existent-id')
          .notToExist(),
      ));

  void it('with idempotency check', () => {
    const couponId = uuid();

    return given(
      eventsInStream<ProductItemAdded>(shoppingCartId, [
        {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 100 },
          },
        },
      ]),
    )
      .when(
        newEventsInStream(shoppingCartId, [
          {
            type: 'DiscountApplied',
            data: { percent: 10, couponId },
          },
        ]),
        { numberOfTimes: 2 },
      )
      .then(
        expectPongoDocuments
          .fromCollection<ShoppingCartShortInfo>(
            shoppingCartShortInfoCollectionName,
          )
          .withId(shoppingCartId)
          .toBeEqual({
            productItemsCount: 100,
            totalAmount: 9000,
            appliedDiscounts: [couponId],
          }),
      );
  });
});

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
  appliedDiscounts: string[];
};

const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';

const evolve = (
  document: ShoppingCartShortInfo,
  { type, data: event }: ProductItemAdded | DiscountApplied,
): ShoppingCartShortInfo => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
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
    productItemsCount: 0,
    totalAmount: 0,
    appliedDiscounts: [],
  }),
});
