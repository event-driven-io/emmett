import { getPostgreSQLStartedContainer } from '@event-driven-io/emmett-testcontainers';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  eventInStream,
  expectPongoDocuments,
  pongoMultiStreamProjection,
  pongoSingleStreamProjection,
  PostgreSQLProjectionSpec,
} from '.';
import type { ProductItemAdded } from '../../testing/shoppingCart.domain';

type ProductTally = {
  productItemsCount: number;
  totalAmount: number;
};

const evolve = (
  document: ProductTally,
  { type, data }: ProductItemAdded,
): ProductTally => {
  switch (type) {
    case 'ProductItemAdded':
      return {
        ...document,
        totalAmount:
          document.totalAmount +
          data.productItem.price * data.productItem.quantity,
        productItemsCount:
          document.productItemsCount + data.productItem.quantity,
      };
    default:
      return document;
  }
};

const initialState = (): ProductTally => ({
  productItemsCount: 0,
  totalAmount: 0,
});

const nullableIdCollectionName = 'productTallyByNullableId';
const fanOutCollectionName = 'productTallyByCategory';

// returns null for products that should be ignored
const nullableIdProjection = pongoSingleStreamProjection<
  ProductTally,
  ProductItemAdded
>({
  collectionName: nullableIdCollectionName,
  evolve,
  canHandle: ['ProductItemAdded'],
  initialState,
  getDocumentId: (event) =>
    event.data.productItem.productId.startsWith('ignored')
      ? null
      : event.data.productItem.productId,
});

// fans a single event into a per-product and a per-stream "all" document,
// and skips the event entirely when there are no ids to update
const fanOutProjection = pongoMultiStreamProjection<
  ProductTally,
  ProductItemAdded
>({
  collectionName: fanOutCollectionName,
  evolve,
  canHandle: ['ProductItemAdded'],
  initialState,
  getDocumentIds: (event) =>
    event.data.productItem.quantity === 0
      ? []
      : [event.data.productItem.productId, `${event.metadata.streamName}:all`],
});

void describe('Pongo projection document id behaviour', () => {
  let postgres: StartedPostgreSqlContainer;
  let connectionString: string;
  let givenNullableId: PostgreSQLProjectionSpec<ProductItemAdded>;
  let givenFanOut: PostgreSQLProjectionSpec<ProductItemAdded>;
  let streamName: string;
  let productId: string;
  let allId: string;

  beforeAll(async () => {
    postgres = await getPostgreSQLStartedContainer();
    connectionString = postgres.getConnectionUri();

    givenNullableId = PostgreSQLProjectionSpec.for({
      projection: nullableIdProjection,
      connectionString,
    });
    givenFanOut = PostgreSQLProjectionSpec.for({
      projection: fanOutProjection,
      connectionString,
    });
  });

  beforeEach(() => {
    streamName = `shoppingCart:${uuid()}`;
    // unique ids keep tests isolated within the shared database
    productId = `shoes-${uuid()}`;
    allId = `${streamName}:all`;
  });

  afterAll(async () => {
    try {
      await postgres.stop();
    } catch (error) {
      console.log(error);
    }
  });

  void it('skips the event when getDocumentId returns null', () => {
    const ignoredId = `ignored-${uuid()}`;

    return givenNullableId([])
      .when([
        eventInStream(streamName, {
          type: 'ProductItemAdded',
          data: {
            productItem: {
              price: 100,
              productId: ignoredId,
              quantity: 100,
            },
          },
        }),
      ])
      .then(
        expectPongoDocuments
          .fromCollection<ProductTally>(nullableIdCollectionName)
          .withId(ignoredId)
          .notToExist(),
      );
  });

  void it('uses the returned id when getDocumentId returns a string', () =>
    givenNullableId([])
      .when([
        eventInStream(streamName, {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId, quantity: 100 },
          },
        }),
      ])
      .then(
        expectPongoDocuments
          .fromCollection<ProductTally>(nullableIdCollectionName)
          .withId(productId)
          .toBeEqual({ productItemsCount: 100, totalAmount: 10000 }),
      ));

  void it('skips the event when getDocumentIds returns an empty array', () =>
    givenFanOut([])
      .when([
        eventInStream(streamName, {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId, quantity: 0 },
          },
        }),
      ])
      .then(async (options) => {
        await expectPongoDocuments
          .fromCollection<ProductTally>(fanOutCollectionName)
          .withId(productId)
          .notToExist()(options);
        await expectPongoDocuments
          .fromCollection<ProductTally>(fanOutCollectionName)
          .withId(allId)
          .notToExist()(options);
      }));

  void it('updates every document when getDocumentIds returns multiple ids', () =>
    givenFanOut([])
      .when([
        eventInStream(streamName, {
          type: 'ProductItemAdded',
          data: {
            productItem: { price: 100, productId, quantity: 100 },
          },
        }),
      ])
      .then(
        expectPongoDocuments
          .fromCollection<ProductTally>(fanOutCollectionName)
          .matching({
            _id: { $in: [productId, allId] },
            productItemsCount: 100,
            totalAmount: 10000,
          })
          .toHaveCount(2),
      ));
});
