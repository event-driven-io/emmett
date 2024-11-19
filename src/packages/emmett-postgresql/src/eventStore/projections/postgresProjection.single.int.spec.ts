import type { Event } from '@event-driven-io/emmett';
import type { PongoDBCollectionOptions } from '@event-driven-io/pongo';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { v4 as uuid } from 'uuid';
import {
  sharedPostgreSQLDatabase,
  type PostgreSQLTestDatabase,
} from '../../testing/postgreSQLTestDatabase';
import {
  documentExists,
  eventInStream,
  eventsInStream,
  expectPongoDocuments,
  newEventsInStream,
  pongoSingleStreamProjection,
  PostgreSQLProjectionSpec,
} from '.';
import type {
  DiscountApplied,
  ProductItemAdded,
} from '../../testing/shoppingCart.domain';

void describe('Postgres Projections', () => {
  let database: PostgreSQLTestDatabase;
  let connectionString: string;
  let given: PostgreSQLProjectionSpec<ProductItemAdded | DiscountApplied>;
  let givenDatedDocument: PostgreSQLProjectionSpec<DocumentOpened>;
  let shoppingCartId: string;

  beforeAll(async () => {
    database = await sharedPostgreSQLDatabase();
    connectionString = database.connectionString;

    given = PostgreSQLProjectionSpec.for({
      projection: shoppingCartShortInfoProjection,
      connectionString,
    });
    givenDatedDocument = PostgreSQLProjectionSpec.for({
      projection: datedDocumentProjection,
      connectionString,
    });
  });

  beforeEach(() => (shoppingCartId = `shoppingCart:${uuid()}:${uuid()}`));

  afterAll(async () => {
    try {
      await database?.close();
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

  void it('upcasts dates before comparing documents', () => {
    const openedAt = new Date();

    return givenDatedDocument([])
      .when([
        {
          type: 'DocumentOpened',
          data: { openedAt },
          metadata: { streamName: shoppingCartId },
        },
      ])
      .then(
        documentExists<DatedDocument, DatedDocumentPayload>(
          { openedAt },
          {
            inCollection: datedDocumentCollectionName,
            collectionOptions: datedDocumentCollectionOptions,
            withId: shoppingCartId,
          },
        ),
      );
  });

  void it('can normalize dates when comparing raw documents', () => {
    const openedAt = new Date();

    return givenDatedDocument([])
      .when([
        {
          type: 'DocumentOpened',
          data: { openedAt },
          metadata: { streamName: shoppingCartId },
        },
      ])
      .then(
        documentExists<DatedDocument>(
          { openedAt },
          {
            inCollection: datedDocumentCollectionName,
            normalizeDates: true,
            withId: shoppingCartId,
          },
        ),
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

type DocumentOpened = Event<'DocumentOpened', { openedAt: Date }>;
type DatedDocument = { openedAt: Date };
type DatedDocumentPayload = { openedAt: string };

const datedDocumentCollectionName = 'datedDocument';
const datedDocumentCollectionOptions = {
  schema: {
    versioning: {
      upcast: ({ openedAt }: DatedDocumentPayload): DatedDocument => ({
        openedAt: new Date(openedAt),
      }),
      downcast: ({ openedAt }: DatedDocument): DatedDocumentPayload => ({
        openedAt: openedAt.toISOString(),
      }),
    },
  },
} satisfies PongoDBCollectionOptions<DatedDocument, DatedDocumentPayload>;

const datedDocumentProjection = pongoSingleStreamProjection({
  collectionName: datedDocumentCollectionName,
  collectionOptions: datedDocumentCollectionOptions,
  evolve: (
    document: DatedDocument | null,
    { type, data }: DocumentOpened,
  ): DatedDocument | null =>
    type === 'DocumentOpened' ? { openedAt: data.openedAt } : document,
  canHandle: ['DocumentOpened'],
});
