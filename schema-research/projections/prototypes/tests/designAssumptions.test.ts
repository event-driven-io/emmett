// Checks the design assumptions the first suite left open, on the events PoC (prototypes/api-ergonomics)
// and real stores: MongoDB on localhost:27099, SQLite files for Pongo and Dumbo.
// Run: npm test
import { projections } from '@event-driven-io/emmett';
import { getMongoDBEventStore, type MongoDBEventStore } from '@event-driven-io/emmett-mongodb';
import { createTableSQL, dumboSchema, JSONSerializer as DumboJSONSerializer } from '@event-driven-io/dumbo';
import { sqliteFormatter } from '@event-driven-io/dumbo/sqlite';
import { pongoClient } from '@event-driven-io/pongo';
import { pongoDriver as sqlite3PongoDriver } from '@event-driven-io/pongo/sqlite3';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { MongoClient, ObjectId } from 'mongodb';
import { type } from 'arktype';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import sqlite3 from 'sqlite3';
import { z } from 'zod';
import { s } from '../../../prototypes/api-ergonomics/lib/index.js';
import * as A from '../../../prototypes/api-ergonomics/styles/a-builtin/shoppingCart.js';
import * as B from '../../../prototypes/api-ergonomics/styles/b-zod/shoppingCart.js';
import { avroFormats, avroType } from '../lib/avroSchema.js';
import { dumboColumns } from '../lib/dumboSchema.js';
import {
  findInlineProjection,
  inlineProjectionValidator,
  mongoDBFormats,
  mongoDBSchemaInlineProjection,
  objectId,
  objectIdPattern,
  toMongoDBValidator,
  type MongoDBProjectionSchema,
} from '../lib/mongoDBSchema.js';
import { pongoFormats } from '../lib/pongoSchema.js';
import { compiledCodec, documentCodec, jsonSchemaOf, type DocumentSchema } from '../lib/projectionSchema.js';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

const int64 = z.codec(z.stringFormat('int64', /^-?\d+$/), z.bigint(), { decode: (v) => BigInt(v), encode: (v) => v.toString() });

type Order = { orderId: string; total: bigint; placedAt: Date; cancelledAt: Date | null };

const orderSchemas: Record<string, DocumentSchema<Order>> = {
  's builder': s.object({ orderId: objectId(), total: s.bigint(), placedAt: s.date(), cancelledAt: s.nullable(s.date()) }),
  zod: z.object({ orderId: z.stringFormat('objectid', objectIdPattern), total: int64, placedAt: B.isoDate, cancelledAt: B.isoDate.nullable() }),
};

const bigOrder: Order = { orderId: '64f000000000000000000001', total: 2n ** 60n, placedAt: new Date('2026-10-31T09:00:00.000Z'), cancelledAt: null };
const smallOrder: Order = { orderId: '64f000000000000000000002', total: 42n, placedAt: new Date('2026-10-30T09:00:00.000Z'), cancelledAt: new Date('2026-10-30T10:00:00.000Z') };

type CartSummary = { clientId: string; totalAmount: number; items: { productId: string; addedAt: Date }[]; confirmedAt?: Date | undefined };
type CartEvent = A.ProductItemAddedToShoppingCart | A.ShoppingCartConfirmed;

const cartSchemas: Record<string, { schema: DocumentSchema<CartSummary>; events: typeof A | typeof B }> = {
  's builder': {
    schema: s.object({ clientId: objectId(), totalAmount: s.number(), items: s.array(s.object({ productId: s.string(), addedAt: s.date() })), confirmedAt: s.optional(s.date()) }),
    events: A,
  },
  zod: {
    schema: z.object({ clientId: z.stringFormat('objectid', objectIdPattern), totalAmount: z.number(), items: z.array(z.object({ productId: z.string(), addedAt: B.isoDate })), confirmedAt: B.isoDate.optional() }),
    events: B,
  },
};

const clientId = '64f000000000000000000001';
const addedAt = new Date('2026-10-31T09:00:00.000Z');
const confirmedAt = new Date('2026-10-31T10:00:00.000Z');
const expectedSummary: CartSummary = { clientId, totalAmount: 100, items: [{ productId: 'shoes', addedAt }], confirmedAt };

const evolve = (state: CartSummary | null, event: CartEvent): CartSummary => {
  switch (event.type) {
    case 'ProductItemAddedToShoppingCart': {
      const { clientId, productItem, addedAt } = event.data;
      return { clientId, totalAmount: (state?.totalAmount ?? 0) + productItem.quantity * productItem.unitPrice, items: [...(state?.items ?? []), { productId: productItem.productId, addedAt }] };
    }
    case 'ShoppingCartConfirmed':
      return { ...state!, confirmedAt: event.data.confirmedAt };
  }
};

const productItemAdded = (events: typeof A | typeof B, streamName: string) =>
  events.ProductItemAddedToShoppingCart({ shoppingCartId: streamName, clientId, productItem: { productId: 'shoes', quantity: 2, unitPrice: 50 }, addedAt }, { clientId }) as CartEvent;
const cartConfirmed = (events: typeof A | typeof B, streamName: string) =>
  events.ShoppingCartConfirmed({ shoppingCartId: streamName, confirmedAt }, { clientId }) as CartEvent;

const canHandle: CartEvent['type'][] = ['ProductItemAddedToShoppingCart', 'ShoppingCartConfirmed'];
const streamCollectionName = 'emt:shopping_cart';

const removeSQLiteFile = (fileName: string) => {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${fileName}${suffix}`, { force: true });
};

const bsonTypes = async (collection: ReturnType<ReturnType<MongoClient['db']>['collection']>, fields: string[]) =>
  collection.aggregate([{ $project: { _id: 0, ...Object.fromEntries(fields.map((field) => [field, { $type: `$${field}` }])) } }]).toArray();

describe('MongoDB', () => {
  const client = new MongoClient('mongodb://localhost:27099/design_assumptions');
  before(() => client.connect());
  after(() => client.close());
  beforeEach(() => client.db().dropDatabase());

  describe('bigint and nullable fields', () => {
    for (const [style, schema] of Object.entries(orderSchemas)) {
      it(`${style}: stores bigint as Long and gives the code a bigint, small and large`, async () => {
        const codec = documentCodec(schema, mongoDBFormats, { validation: { onWrite: true, onRead: true } });
        const collection = client.db().collection('orders');
        await collection.insertMany([codec.write(bigOrder), codec.write(smallOrder)]);

        assert.deepEqual(await bsonTypes(collection, ['total', 'cancelledAt']), [
          { total: 'long', cancelledAt: 'null' },
          { total: 'long', cancelledAt: 'date' },
        ]);
        const stored = await collection.find({}, { projection: { _id: 0 }, sort: { placedAt: -1 } }).toArray();
        assert.deepEqual(stored.map((document) => codec.read(document)), [bigOrder, smallOrder]);
      });

      it(`${style}: rejects a total that is not an integer when write validation is on`, () => {
        const codec = documentCodec(schema, mongoDBFormats, { validation: { onWrite: true } });

        assert.throws(() => codec.write({ ...bigOrder, total: 'a lot' as unknown as bigint }), /total/);
      });
    }
  });

  describe('a date-time field the code keeps as an ISO string', () => {
    it('zod z.iso.datetime(): stores a BSON date and gives the code the ISO string back', async () => {
      const schema = z.object({ at: z.iso.datetime() });
      const codec = documentCodec(schema, mongoDBFormats);
      const collection = client.db().collection('texts');
      await collection.insertOne(codec.write({ at: '2026-10-31T09:00:00.000Z' }));

      const stored = await collection.findOne({}, { projection: { _id: 0 } });
      assert.ok(stored!.at instanceof Date);
      assert.deepEqual(codec.read(stored!), { at: '2026-10-31T09:00:00.000Z' });
    });
  });

  describe('a third Standard Schema library', () => {
    it('arktype: with format set through configure, stores BSON types and gives the code a string id, a Date and an ISO string', async () => {
      const schema = type({
        clientId: type(/^[0-9a-f]{24}$/).configure({ format: 'objectid' }),
        placedAt: type('string.date.iso.parse').configure({ format: 'date-time' }),
        placedAtText: type('string.date.iso').configure({ format: 'date-time' }),
      });
      const codec = documentCodec(schema, mongoDBFormats, { validation: { onWrite: true, onRead: true } });
      const collection = client.db().collection('arktype');
      const value = { clientId, placedAt: addedAt, placedAtText: addedAt.toISOString() };
      await collection.insertOne(codec.write(value));

      assert.deepEqual(await bsonTypes(collection, ['clientId', 'placedAt', 'placedAtText']), [{ clientId: 'objectId', placedAt: 'date', placedAtText: 'date' }]);
      assert.deepEqual(codec.read((await collection.findOne({}, { projection: { _id: 0 } }))!), value);
    });
  });

  describe('validator derived from the description', () => {
    const keywords = z.object({
      quantity: z.int(),
      price: z.number().positive(),
      status: z.enum(['open', 'closed']),
      kind: z.literal('order'),
      currency: z.string().regex(/^[A-Z]{3}$/),
      tags: z.array(z.string()).min(1),
      cancelledAt: B.isoDate.nullable(),
      total: int64,
    });
    type Keywords = z.infer<typeof keywords>;
    const valid: Keywords = { quantity: 2 ** 40, price: 9.99, status: 'open', kind: 'order', currency: 'EUR', tags: ['a'], cancelledAt: null, total: 2n ** 60n };

    it('zod: MongoDB accepts the validator for integer, exclusiveMinimum, enum, const, pattern, minItems and nullable, and enforces each', async () => {
      const codec = documentCodec(keywords, mongoDBFormats);
      const collection = await client.db().createCollection('keywords', { validator: { $jsonSchema: toMongoDBValidator(jsonSchemaOf(keywords), mongoDBFormats) } });

      await collection.insertOne(codec.write(valid));
      for (const invalid of [{ quantity: 1.5 }, { price: 0 }, { status: 'other' }, { kind: 'invoice' }, { currency: 'eur' }, { tags: [] }])
        await assert.rejects(collection.insertOne({ ...codec.write(valid), ...invalid }), /Document failed validation/, JSON.stringify(invalid));
    });

    for (const [style, { schema, events }] of Object.entries(cartSchemas)) {
      it(`${style}: rejects a field the schema does not have, and accepts the _metadata Emmett adds`, async () => {
        const projection: MongoDBProjectionSchema<CartSummary> = { name: 'summary', schema };
        await client.db().createCollection(streamCollectionName, { validator: inlineProjectionValidator(projection) });
        const eventStore = getMongoDBEventStore({ client, projections: projections.inline([mongoDBSchemaInlineProjection({ ...projection, canHandle, evolve })]) });
        const collection = await eventStore.collectionFor('shopping_cart');

        await eventStore.appendToStream('shopping_cart:cart-1', [productItemAdded(events, 'shopping_cart:cart-1')]);

        const additionalProperties = (jsonSchemaOf(schema) as { additionalProperties?: boolean }).additionalProperties;
        const unknownField = collection.updateOne({}, { $set: { 'projections.summary.unknown': 1 } });
        if (additionalProperties === false) await assert.rejects(unknownField, /Document failed validation/);
        else assert.equal((await unknownField).modifiedCount, 1);
      });
    }
  });

  describe('Emmett setting the validator', () => {
    const { schema, events } = cartSchemas['zod']!;
    const summary: MongoDBProjectionSchema<CartSummary> = { name: 'summary', schema };
    const other: MongoDBProjectionSchema<{ count: number }> = { name: 'other', schema: z.object({ count: z.number() }) };
    const validator = inlineProjectionValidator(summary, other);

    it('keeps a validator set when the stream collection is created, after the event store opens it', async () => {
      await client.db().createCollection(streamCollectionName, { validator });
      const eventStore = getMongoDBEventStore({ client, projections: projections.inline([mongoDBSchemaInlineProjection({ ...summary, canHandle, evolve })]) });
      const collection = await eventStore.collectionFor('shopping_cart');

      await eventStore.appendToStream('shopping_cart:cart-1', [productItemAdded(events, 'shopping_cart:cart-1')]);

      assert.equal(collection.collectionName, streamCollectionName);
      await assert.rejects(collection.updateOne({}, { $set: { 'projections.summary.clientId': clientId } }), /Document failed validation/);
    });

    it('cannot create a stream collection that already exists, so an existing one needs collMod', async () => {
      const eventStore = getMongoDBEventStore({ client });
      await eventStore.collectionFor('shopping_cart');

      await assert.rejects(client.db().createCollection(streamCollectionName, { validator }), /already exists/);
      await client.db().command({ collMod: streamCollectionName, validator });
    });

    it('covers every inline projection with one validator, also streams that have only some of them', async () => {
      await client.db().createCollection(streamCollectionName, { validator });
      const eventStore = getMongoDBEventStore({ client, projections: projections.inline([mongoDBSchemaInlineProjection({ ...summary, canHandle, evolve })]) });
      const collection = await eventStore.collectionFor('shopping_cart');

      await eventStore.appendToStream('shopping_cart:cart-1', [productItemAdded(events, 'shopping_cart:cart-1')]);

      await assert.rejects(collection.updateOne({}, { $set: { 'projections.other': { count: 'many' } } }), /Document failed validation/);
      assert.equal((await collection.updateOne({}, { $set: { 'projections.other': { count: 1 } } })).modifiedCount, 1);
    });
  });

  describe('validator on a collection with older documents', () => {
    const { schema, events } = cartSchemas['zod']!;
    const projection: MongoDBProjectionSchema<CartSummary> = {
      name: 'summary',
      schema,
      upcast: ({ total, ...rest }) => (total === undefined ? rest : { ...rest, totalAmount: total }),
    };
    const oldSummary = { clientId: new ObjectId(clientId), total: 30, items: [], _metadata: { schemaVersion: 1 } };

    const setUp = async (validationLevel: 'strict' | 'moderate') => {
      const eventStore: MongoDBEventStore = getMongoDBEventStore({ client, projections: projections.inline([mongoDBSchemaInlineProjection({ ...projection, canHandle, evolve })]) });
      const collection = await eventStore.collectionFor('shopping_cart');
      await eventStore.appendToStream('shopping_cart:old', [productItemAdded(events, 'shopping_cart:old')]);
      await collection.updateOne({ streamName: 'shopping_cart:old' }, { $set: { 'projections.summary': oldSummary } });
      await client.db().command({ collMod: streamCollectionName, validator: inlineProjectionValidator(projection), validationLevel });
      return { eventStore, collection };
    };

    it('strict: appending to an old stream works because the projection is rewritten in the new shape', async () => {
      const { eventStore, collection } = await setUp('strict');

      await eventStore.appendToStream('shopping_cart:old', [cartConfirmed(events, 'shopping_cart:old')]);

      const stream = await collection.findOne({ streamName: 'shopping_cart:old' });
      assert.equal(stream!.projections.summary!.totalAmount, 30);
    });

    it('strict rejects an update that leaves an old document invalid, moderate accepts it and still rejects new invalid ones', async () => {
      const strict = await setUp('strict');
      await assert.rejects(strict.collection.updateOne({ streamName: 'shopping_cart:old' }, { $set: { 'metadata.touched': true } }), /Document failed validation/);

      await client.db().dropDatabase();
      const moderate = await setUp('moderate');
      assert.equal((await moderate.collection.updateOne({ streamName: 'shopping_cart:old' }, { $set: { 'metadata.touched': true } })).modifiedCount, 1);
      await assert.rejects(moderate.collection.insertOne({ streamName: 'shopping_cart:new', messages: [], projections: { summary: oldSummary } } as never), /Document failed validation/);
    });
  });

  describe('upcast and downcast', () => {
    const { schema, events } = cartSchemas['zod']!;

    it('gives the upcaster the schema version that wrote the stored state', async () => {
      const seen: (number | undefined)[] = [];
      const projectionAt = (schemaVersion: number) =>
        mongoDBSchemaInlineProjection<CartSummary, CartEvent>({
          name: 'summary',
          schema,
          schemaVersion,
          upcast: (json, context) => (seen.push(context.schemaVersion), json),
          canHandle,
          evolve,
        });
      await getMongoDBEventStore({ client, projections: projections.inline([projectionAt(1)]) }).appendToStream('shopping_cart:cart-1', [productItemAdded(events, 'shopping_cart:cart-1')]);
      const eventStore = getMongoDBEventStore({ client, projections: projections.inline([projectionAt(2)]) });

      await eventStore.appendToStream('shopping_cart:cart-1', [cartConfirmed(events, 'shopping_cart:cart-1')]);

      assert.deepEqual(seen, [1]);
      const stream = await (await eventStore.collectionFor('shopping_cart')).findOne({});
      assert.equal(stream!.projections.summary!._metadata.schemaVersion, 2);
    });

    it('stores the downcast shape and reads it back through the upcaster', async () => {
      const codec = documentCodec(schema, mongoDBFormats, {
        validation: { onWrite: true, onRead: true },
        downcast: ({ totalAmount, ...rest }) => ({ ...rest, total: totalAmount }),
        upcast: ({ total, ...rest }) => ({ ...rest, totalAmount: total }),
      });
      const collection = client.db().collection('downcast');
      await collection.insertOne(codec.write(expectedSummary));

      const stored = await collection.findOne({}, { projection: { _id: 0 } });
      assert.equal(stored!.total, 100);
      assert.equal(stored!.totalAmount, undefined);
      assert.deepEqual(codec.read(stored!), expectedSummary);
    });

    it('documents the conflict: a validator derived from the code schema rejects the downcast shape', async () => {
      const projection: MongoDBProjectionSchema<CartSummary> = { name: 'summary', schema, downcast: ({ totalAmount, ...rest }) => ({ ...rest, total: totalAmount }) };
      await client.db().createCollection(streamCollectionName, { validator: inlineProjectionValidator(projection) });
      const eventStore = getMongoDBEventStore({ client, projections: projections.inline([mongoDBSchemaInlineProjection({ ...projection, canHandle, evolve })]) });

      await assert.rejects(eventStore.appendToStream('shopping_cart:cart-1', [productItemAdded(events, 'shopping_cart:cart-1')]), /Document failed validation/);
    });
  });

  describe('query filters', () => {
    for (const [style, schema] of Object.entries(orderSchemas)) {
      it(`${style}: converts operator values, a date range and ids in $in`, async () => {
        const codec = documentCodec(schema, mongoDBFormats);
        const collection = client.db().collection('orders');
        await collection.insertMany([codec.write(bigOrder), codec.write(smallOrder)]);

        const found = await collection
          .find(codec.filter({ placedAt: { $gte: '2026-10-31T00:00:00.000Z' }, orderId: { $in: [bigOrder.orderId, smallOrder.orderId] } }), { projection: { _id: 0 } })
          .toArray();
        assert.deepEqual(found.map((document) => codec.read(document)), [bigOrder]);
      });
    }

    it('finds an inline projection by a date range written as the code sees it', async () => {
      const { schema, events } = cartSchemas['zod']!;
      const projection: MongoDBProjectionSchema<CartSummary> = { name: 'summary', schema };
      const eventStore = getMongoDBEventStore({ client, projections: projections.inline([mongoDBSchemaInlineProjection({ ...projection, canHandle, evolve })]) });
      await eventStore.appendToStream('shopping_cart:cart-1', [productItemAdded(events, 'shopping_cart:cart-1'), cartConfirmed(events, 'shopping_cart:cart-1')]);

      assert.deepEqual(await findInlineProjection(eventStore, 'shopping_cart', projection, { confirmedAt: { $lt: '2026-11-01T00:00:00.000Z' } }), expectedSummary);
      assert.equal(await findInlineProjection(eventStore, 'shopping_cart', projection, { confirmedAt: { $gt: confirmedAt } }), null);
    });
  });
});

describe('Pongo (SQLite)', () => {
  for (const [style, schema] of Object.entries(orderSchemas)) {
    it(`${style}: stores bigint as a string and null as null, gives the code a bigint and null, and filters a date range`, async () => {
      const fileName = `./pongo-orders-${style.replace(/\W/g, '_')}-${Date.now()}.db`;
      const pongo = pongoClient({ connectionString: fileName, driver: sqlite3PongoDriver });
      try {
        const codec = documentCodec(schema, pongoFormats, { validation: { onWrite: true, onRead: true } });
        const orders = pongo.db().collection<Record<string, unknown>>('orders');
        await orders.insertOne({ _id: 'big', ...codec.write(bigOrder) });
        await orders.insertOne({ _id: 'small', ...codec.write(smallOrder) });

        const stored = await orders.findOne({ _id: 'big' });
        const { _id, _version, ...state } = stored!;
        assert.equal(state.total, (2n ** 60n).toString());
        assert.equal(state.cancelledAt, null);
        assert.deepEqual(codec.read(state), bigOrder);

        const found = await orders.find(codec.filter({ placedAt: { $gte: '2026-10-31T00:00:00.000Z' } }));
        assert.deepEqual(found.map((document) => document._id), ['big']);
      } finally {
        await pongo.close();
        removeSQLiteFile(fileName);
      }
    });
  }
});

describe('JSON Schema export for projections', () => {
  for (const [style, { schema }] of Object.entries(cartSchemas)) {
    it(`${style}: ajv validates the JSON form of the state once the custom formats are registered`, () => {
      const json = jsonSchemaOf(schema);
      const toJSON = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

      assert.throws(() => addFormats(new Ajv2020()).compile(json), /unknown format "objectid"/);
      const validate = addFormats(new Ajv2020()).addFormat('objectid', objectIdPattern).compile(json);
      assert.equal(validate(toJSON(expectedSummary)), true);
      assert.equal(validate(toJSON({ ...expectedSummary, clientId: 'not-an-id' })), false);
      assert.equal(validate(toJSON({ ...expectedSummary, items: [{ productId: 'shoes', addedAt: 'yesterday' }] })), false);
    });
  }
});

describe('Avro schema from the description', () => {
  for (const [style, { schema }] of Object.entries(cartSchemas)) {
    it(`${style}: avsc round-trips the state with Avro formats, the same mechanism as storage formats`, () => {
      const type = avroType(jsonSchemaOf(schema), 'CartSummary');
      const codec = documentCodec(schema, avroFormats);

      assert.deepEqual(codec.read(type.fromBuffer(type.toBuffer(codec.write(expectedSummary)))), expectedSummary);
    });
  }

  for (const [style, schema] of Object.entries(orderSchemas)) {
    it(`${style}: avsc round-trips bigint as an Avro long and null in a union`, () => {
      const type = avroType(jsonSchemaOf(schema), 'Order');
      const codec = documentCodec(schema, avroFormats);

      assert.deepEqual(codec.read(type.fromBuffer(type.toBuffer(codec.write(bigOrder)))), bigOrder);
    });
  }

  it('documents a difference: an absent optional field comes back from Avro as null', () => {
    const { schema } = cartSchemas['zod']!;
    const type = avroType(jsonSchemaOf(schema), 'CartSummary');
    const codec = documentCodec(schema, avroFormats);
    const { confirmedAt: _, ...unconfirmed } = expectedSummary;

    assert.equal(codec.read(type.fromBuffer(type.toBuffer(codec.write(unconfirmed)))).confirmedAt, null);
  });
});

describe('Dumbo columns from the description', () => {
  for (const [style, schema] of Object.entries(orderSchemas)) {
    it(`${style}: gives a table that SQLite creates, with types from JSON Schema type and format`, async () => {
      const table = dumboSchema.table('orders', { columns: dumboColumns(jsonSchemaOf(schema)) });
      const { query } = sqliteFormatter.format(createTableSQL(table), { serializer: DumboJSONSerializer });

      assert.equal(query, 'CREATE TABLE IF NOT EXISTS orders ("orderId" TEXT NOT NULL, total INTEGER NOT NULL, "placedAt" DATETIME NOT NULL, "cancelledAt" DATETIME)');
      const database = new sqlite3.Database(':memory:');
      await new Promise<void>((resolve, reject) => database.exec(query, (error) => (error ? reject(error) : resolve())));
      await new Promise<void>((resolve) => database.close(() => resolve()));
    });
  }

  it('zod: maps integer, number, boolean, enum and nested objects', () => {
    const schema = z.object({ quantity: z.int(), price: z.number(), paid: z.boolean(), status: z.enum(['open', 'closed']), address: z.object({ city: z.string() }), notes: z.string().optional() });
    const table = dumboSchema.table('details', { columns: dumboColumns(jsonSchemaOf(schema)) });

    assert.equal(
      sqliteFormatter.format(createTableSQL(table), { serializer: DumboJSONSerializer }).query,
      'CREATE TABLE IF NOT EXISTS details (quantity INTEGER NOT NULL, price DOUBLE PRECISION NOT NULL, paid INTEGER NOT NULL, status TEXT NOT NULL, address TEXT NOT NULL, notes TEXT)',
    );
  });
});

describe('Generated converter', () => {
  const cases = [
    ...Object.entries(cartSchemas).map(([style, { schema }]) => [`${style} cart`, schema, expectedSummary] as const),
    ...Object.entries(orderSchemas).map(([style, schema]) => [`${style} order`, schema, bigOrder] as const),
  ];
  for (const [label, schema, value] of cases)
    for (const [storage, formats] of Object.entries({ MongoDB: mongoDBFormats, Pongo: pongoFormats })) {
      it(`${label}, ${storage}: gives the same stored and code values as the generic walk`, () => {
        const walked = documentCodec(schema as DocumentSchema, formats);
        const compiled = compiledCodec(schema as DocumentSchema, formats);

        const stored = compiled.write(value);
        assert.deepEqual(stored, walked.write(value));
        assert.deepEqual(compiled.read(stored), walked.read(stored));
        assert.deepEqual(compiled.read(stored), value);
      });
    }
});
