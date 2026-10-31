// Proves the proposed projection schema flow on the events PoC (prototypes/api-ergonomics) and real
// event stores: MongoDB on localhost:27099, SQLite with Pongo in a temporary file.
// Run: npm test
import { projections } from '@event-driven-io/emmett';
import { getMongoDBEventStore, type MongoDBEventStore } from '@event-driven-io/emmett-mongodb';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { sqlite3EventStoreDriver } from '@event-driven-io/emmett-sqlite/sqlite3';
import { pongoClient } from '@event-driven-io/pongo';
import { pongoDriver as sqlite3PongoDriver } from '@event-driven-io/pongo/sqlite3';
import { Decimal128, MongoClient, ObjectId } from 'mongodb';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { z } from 'zod';
import { s } from '../../../prototypes/api-ergonomics/lib/index.js';
import * as A from '../../../prototypes/api-ergonomics/styles/a-builtin/shoppingCart.js';
import * as B from '../../../prototypes/api-ergonomics/styles/b-zod/shoppingCart.js';
import { stringFormat } from '../lib/builder.js';
import {
  findInlineProjection,
  inlineProjectionValidator,
  mongoDBFormats,
  mongoDBSchemaInlineProjection,
  objectId,
  objectIdPattern,
  type MongoDBProjectionSchema,
} from '../lib/mongoDBSchema.js';
import { pongoFormats, pongoSchemaSingleStreamProjection } from '../lib/pongoSchema.js';
import { documentCodec, type DocumentSchema } from '../lib/projectionSchema.js';

type CartSummary = {
  clientId: string;
  totalAmount: number;
  items: { productId: string; addedAt: Date }[];
  confirmedAt?: Date | undefined;
};
type CartEvent = A.ProductItemAddedToShoppingCart | A.ShoppingCartConfirmed;

const evolve = (state: CartSummary | null, event: CartEvent): CartSummary => {
  switch (event.type) {
    case 'ProductItemAddedToShoppingCart': {
      const { clientId, productItem, addedAt } = event.data;
      return {
        clientId,
        totalAmount: (state?.totalAmount ?? 0) + productItem.quantity * productItem.unitPrice,
        items: [...(state?.items ?? []), { productId: productItem.productId, addedAt }],
      };
    }
    case 'ShoppingCartConfirmed':
      return { ...state!, confirmedAt: event.data.confirmedAt };
  }
};

const styles: Record<string, { schema: DocumentSchema<CartSummary>; events: typeof A | typeof B }> = {
  's builder': {
    schema: s.object({
      clientId: objectId(),
      totalAmount: s.number(),
      items: s.array(s.object({ productId: s.string(), addedAt: s.date() })),
      confirmedAt: s.optional(s.date()),
    }),
    events: A,
  },
  zod: {
    schema: z.object({
      clientId: z.stringFormat('objectid', objectIdPattern),
      totalAmount: z.number(),
      items: z.array(z.object({ productId: z.string(), addedAt: B.isoDate })),
      confirmedAt: B.isoDate.optional(),
    }),
    events: B,
  },
};

const clientId = '64f000000000000000000001';
const addedAt = new Date('2026-10-31T09:00:00.000Z');
const confirmedAt = new Date('2026-10-31T10:00:00.000Z');
const metadata = { clientId };

const appendCart = async (
  eventStore: { appendToStream: (streamName: string, events: CartEvent[]) => Promise<unknown> },
  events: typeof A | typeof B,
  streamName: string,
) => {
  await eventStore.appendToStream(streamName, [
    events.ProductItemAddedToShoppingCart({ shoppingCartId: streamName, clientId, productItem: { productId: 'shoes', quantity: 2, unitPrice: 50 }, addedAt }, metadata),
  ] as CartEvent[]);
  await eventStore.appendToStream(streamName, [
    events.ShoppingCartConfirmed({ shoppingCartId: streamName, confirmedAt }, metadata),
  ] as CartEvent[]);
};

const expectedSummary: CartSummary = { clientId, totalAmount: 100, items: [{ productId: 'shoes', addedAt }], confirmedAt };

describe('MongoDB inline projection with a schema', () => {
  const client = new MongoClient('mongodb://localhost:27099');
  before(() => client.connect());
  after(() => client.close());
  beforeEach(() => client.db().dropDatabase());

  for (const [style, { schema, events }] of Object.entries(styles)) {
    describe(style, () => {
      const projection: MongoDBProjectionSchema<CartSummary> = { name: 'summary', schema, validation: { onWrite: true } };

      const setUp = async ({ withValidator = true } = {}) => {
        const eventStore: MongoDBEventStore = getMongoDBEventStore({
          client,
          projections: projections.inline([
            mongoDBSchemaInlineProjection({ ...projection, canHandle: ['ProductItemAddedToShoppingCart', 'ShoppingCartConfirmed'], evolve }),
          ]),
        });
        const collection = await eventStore.collectionFor('shopping_cart');
        if (withValidator)
          await client.db().command({ collMod: collection.collectionName, validator: inlineProjectionValidator(projection), validationAction: 'error' });
        return { eventStore, collection };
      };

      it('stores ObjectId and dates as BSON types, including inside arrays', async () => {
        const { eventStore, collection } = await setUp();
        await appendCart(eventStore, events, 'shopping_cart:cart-1');

        const [types] = await collection
          .aggregate([{ $project: { _id: 0, clientId: { $type: '$projections.summary.clientId' }, addedAt: { $type: { $arrayElemAt: ['$projections.summary.items.addedAt', 0] } }, confirmedAt: { $type: '$projections.summary.confirmedAt' } } }])
          .toArray();
        assert.deepEqual(types, { clientId: 'objectId', addedAt: 'date', confirmedAt: 'date' });
      });

      it('gives evolve and readers the values the code uses: string id and Date', async () => {
        const { eventStore } = await setUp();
        await appendCart(eventStore, events, 'shopping_cart:cart-1');

        assert.deepEqual(await findInlineProjection(eventStore, 'shopping_cart', projection, { clientId }), expectedSummary);
      });

      it('finds the projection by a string id and by a date written as the code sees them', async () => {
        const { eventStore } = await setUp();
        await appendCart(eventStore, events, 'shopping_cart:cart-1');

        assert.equal((await findInlineProjection(eventStore, 'shopping_cart', projection, { clientId }))?.clientId, clientId);
        assert.equal((await findInlineProjection(eventStore, 'shopping_cart', projection, { 'items.addedAt': addedAt.toISOString() }))?.clientId, clientId);
        assert.equal(await findInlineProjection(eventStore, 'shopping_cart', projection, { clientId: '64f0000000000000000000ff' }), null);
      });

      it('rejects invalid state before it reaches MongoDB when write validation is on', () => {
        const codec = documentCodec(schema, mongoDBFormats, { validation: { onWrite: true } });

        assert.throws(() => codec.write({ ...expectedSummary, clientId: 'not-an-id' }), /clientId/);
        assert.throws(() => codec.write({ ...expectedSummary, totalAmount: 'a lot' as unknown as number }), /totalAmount/);
      });

      it('converts without calling validate() when validation is off', async () => {
        let calls = 0;
        const counted = {
          '~standard': { ...schema['~standard'], validate: (value: unknown) => (calls++, schema['~standard'].validate(value)) },
        } as DocumentSchema<CartSummary>;
        const codec = documentCodec(counted, mongoDBFormats);

        const stored = codec.write(expectedSummary);
        assert.ok(stored.clientId instanceof ObjectId);
        assert.deepEqual(codec.read(stored), expectedSummary);
        assert.equal(calls, 0);
      });

      it('rejects an invalid stored document on read only when read validation is on', () => {
        const stored = { clientId: new ObjectId(clientId), totalAmount: 'a lot', items: [] };

        assert.equal(documentCodec(schema, mongoDBFormats).read(stored).totalAmount, 'a lot');
        assert.throws(() => documentCodec(schema, mongoDBFormats, { validation: { onRead: true } }).read(stored), /totalAmount/);
      });

      it('lets MongoDB reject a wrong BSON type when the codec is bypassed', async () => {
        const { eventStore, collection } = await setUp();
        await appendCart(eventStore, events, 'shopping_cart:cart-1');

        await assert.rejects(collection.updateOne({}, { $set: { 'projections.summary.clientId': clientId } }), /Document failed validation/);
      });

      it('upcasts an old stored shape before validating it', async () => {
        const upcasting: MongoDBProjectionSchema<CartSummary> = {
          ...projection,
          upcast: ({ total, ...rest }) => (total === undefined ? rest : { ...rest, totalAmount: total }),
        };
        const { eventStore, collection } = await setUp({ withValidator: false });
        await collection.insertOne({
          streamName: 'shopping_cart:old',
          messages: [],
          projections: { summary: { clientId: new ObjectId(clientId), total: 30, items: [], _metadata: { schemaVersion: 1 } } },
        } as never);

        assert.deepEqual(await findInlineProjection(eventStore, 'shopping_cart', upcasting, { clientId }), { clientId, totalAmount: 30, items: [] });
      });
    });
  }

  it('documents the existing bug: projections.inline.findOne breaks an ObjectId in the filter', async () => {
    const { schema, events } = styles['zod']!;
    const eventStore = getMongoDBEventStore({
      client,
      projections: projections.inline([mongoDBSchemaInlineProjection({ name: 'summary', schema, canHandle: ['ProductItemAddedToShoppingCart', 'ShoppingCartConfirmed'], evolve })]),
    });
    await appendCart(eventStore, events, 'shopping_cart:cart-1');

    const found = await eventStore.projections.inline.findOne({ streamType: 'shopping_cart', projectionName: 'summary' }, { clientId: new ObjectId(clientId) });
    assert.equal(found, null);
  });
});

describe('Formats added by the user', () => {
  const client = new MongoClient('mongodb://localhost:27099');
  before(() => client.connect());
  after(() => client.close());

  for (const [style, amount] of Object.entries({
    's builder': stringFormat('decimal128', /^-?\d+(\.\d+)?$/),
    zod: z.stringFormat('decimal128', /^-?\d+(\.\d+)?$/),
  })) {
    it(`${style}: stores a decimal128 field as Decimal128 and reads it back as a string`, async () => {
      const schema = (style === 'zod' ? z.object({ amount: amount as z.ZodType<string> }) : s.object({ amount: amount as ReturnType<typeof stringFormat> })) as DocumentSchema<{ amount: string }>;
      const formats = {
        ...mongoDBFormats,
        decimal128: {
          bsonType: 'decimal',
          toStored: (value: unknown) => Decimal128.fromString(value as string),
          fromStored: (stored: unknown) => (stored instanceof Decimal128 ? stored.toString() : stored),
        },
      };
      const codec = documentCodec(schema, formats, { validation: { onWrite: true } });
      const collection = client.db().collection('decimals');
      await collection.deleteMany({});

      await collection.insertOne(codec.write({ amount: '12.50' }));
      const stored = await collection.findOne({}, { projection: { _id: 0 } });

      assert.ok(stored!.amount instanceof Decimal128);
      assert.deepEqual(codec.read(stored!), { amount: '12.50' });
    });
  }
});

describe('Pongo projection with the same schema and evolve (SQLite)', () => {
  for (const [style, { schema, events }] of Object.entries(styles)) {
    it(`${style}: stores JSON strings and gives the code a string id and Date`, async () => {
      const fileName = `./pongo-${style.replace(/\W/g, '_')}-${Date.now()}.db`;
      const collectionName = 'cart_summary';
      const eventStore = getSQLiteEventStore({
        driver: sqlite3EventStoreDriver,
        fileName,
        schema: { autoMigration: 'CreateOrUpdate' },
        projections: projections.inline([
          pongoSchemaSingleStreamProjection({ collectionName, schema, validation: { onWrite: true }, canHandle: ['ProductItemAddedToShoppingCart', 'ShoppingCartConfirmed'], evolve }),
        ]),
      });
      const pongo = pongoClient({ connectionString: fileName, driver: sqlite3PongoDriver });
      try {
        await appendCart(eventStore, events, 'shopping_cart:cart-1');

        const stored = await pongo.db().collection(collectionName).findOne({ _id: 'shopping_cart:cart-1' });
        const { _id, _version, ...state } = stored!;
        assert.equal(typeof state.clientId, 'string');
        assert.equal(typeof state.confirmedAt, 'string');
        assert.deepEqual(documentCodec(schema, pongoFormats).read(state), expectedSummary);
      } finally {
        await pongo.close();
        await eventStore.close();
        for (const suffix of ['', '-wal', '-shm']) rmSync(`${fileName}${suffix}`, { force: true });
      }
    });
  }
});
