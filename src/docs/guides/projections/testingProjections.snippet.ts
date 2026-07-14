import type { Event } from '@event-driven-io/emmett';
import { pongoSingleStreamProjection } from '@event-driven-io/emmett-postgresql';
import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { v4 as uuid } from 'uuid';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

type ProductItemAdded = Event<
  'ProductItemAdded',
  {
    productItem: { price: number; productId: string; quantity: number };
  }
>;

type DiscountApplied = Event<
  'DiscountApplied',
  {
    percent: number;
    couponId: string;
  }
>;

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

// #region testing-projection
import {
  eventInStream,
  eventsInStream,
  expectPongoDocuments,
  newEventsInStream,
  PostgreSQLProjectionSpec,
} from '@event-driven-io/emmett-postgresql';

void describe('Shopping Cart Short Info Projection', () => {
  let postgres: StartedPostgreSqlContainer;
  let given: PostgreSQLProjectionSpec<ProductItemAdded | DiscountApplied>;
  let shoppingCartId: string;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();

    given = PostgreSQLProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connectionString: postgres.getConnectionUri(),
    });
  });

  beforeEach(() => (shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`));

  afterAll(async () => {
    await postgres.stop();
  });

  void it('creates summary from first event', () =>
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

  void it('accumulates across events', () => {
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
});
// #endregion testing-projection

void describe('Shopping Cart Short Info Projection idempotency', () => {
  let postgres: StartedPostgreSqlContainer;
  let given: PostgreSQLProjectionSpec<ProductItemAdded | DiscountApplied>;
  let shoppingCartId: string;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    given = PostgreSQLProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connectionString: postgres.getConnectionUri(),
    });
  });

  beforeEach(() => (shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`));

  afterAll(async () => {
    await postgres.stop();
  });

  // #region idempotent-projection
  void it('ignores a redelivered event', () => {
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
        // 👇 deliver the same event twice
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
  // #endregion idempotent-projection
});

// #region raw-sql-projection
import { SQL } from '@event-driven-io/dumbo';
import { postgreSQLRawSQLProjection } from '@event-driven-io/emmett-postgresql';

const productSalesTable = 'product_sales';

const productSalesProjection = postgreSQLRawSQLProjection<ProductItemAdded>({
  name: 'productSales',
  canHandle: ['ProductItemAdded'],
  init: () =>
    SQL`CREATE TABLE IF NOT EXISTS ${SQL.identifier(productSalesTable)} (
      product_id TEXT PRIMARY KEY,
      total_amount INT NOT NULL
    )`,
  evolve: ({ data: { productItem } }) =>
    SQL`INSERT INTO ${SQL.identifier(productSalesTable)} (product_id, total_amount)
        VALUES (${productItem.productId}, ${productItem.price * productItem.quantity})
        ON CONFLICT (product_id)
        DO UPDATE SET total_amount = ${SQL.identifier(productSalesTable)}.total_amount + EXCLUDED.total_amount`,
});
// #endregion raw-sql-projection

// #region raw-sql-projection-test
import { expectSQL } from '@event-driven-io/emmett-postgresql';

void describe('Product sales raw SQL projection', () => {
  let postgres: StartedPostgreSqlContainer;
  let given: PostgreSQLProjectionSpec<ProductItemAdded>;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    given = PostgreSQLProjectionSpec.for({
      projection: productSalesProjection,
      connectionString: postgres.getConnectionUri(),
    });
  });

  afterAll(async () => {
    await postgres.stop();
  });

  void it('sums product sales', () =>
    given([])
      .when([
        eventInStream('shoppingCart-1', {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId: 'shoes', quantity: 2 },
          },
        }),
      ])
      .then(
        expectSQL
          .query(
            SQL`SELECT product_id, total_amount FROM ${SQL.identifier(productSalesTable)}`,
          )
          .resultRows.toBeTheSame([{ product_id: 'shoes', total_amount: 200 }]),
      ));
});
// #endregion raw-sql-projection-test
