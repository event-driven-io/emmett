// Reading and writing documents of older schema versions, on MongoDB (localhost:27099) and Pongo with SQLite.
// Run: npm test
import { pongoClient } from '@event-driven-io/pongo';
import { pongoDriver as sqlite3PongoDriver } from '@event-driven-io/pongo/sqlite3';
import { MongoClient } from 'mongodb';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import { z } from 'zod';
import { s } from '../../../prototypes/api-ergonomics/lib/index.js';
import { mongoDBFormats } from '../lib/mongoDBSchema.js';
import { pongoFormats } from '../lib/pongoSchema.js';
import { documentCodec, type DocumentSchema, type FormatCodecs, type JSONDocument } from '../lib/projectionSchema.js';
import { versioned, versionedCodec } from '../lib/versionedSchema.js';

const isoDate = z.codec(z.iso.datetime(), z.date(), { decode: (iso) => new Date(iso), encode: (date) => date.toISOString() });

const orderVersions = {
  's builder': [
    s.object({ orderId: s.string(), placedAt: s.date(), total: s.number() }),
    s.object({ orderId: s.string(), createdAt: s.date(), total: s.number() }),
    s.object({ orderId: s.string(), createdAt: s.date(), total: s.number(), note: s.optional(s.string()) }),
  ] as const,
  zod: [
    z.object({ orderId: z.string(), placedAt: isoDate, total: z.number() }),
    z.object({ orderId: z.string(), createdAt: isoDate, total: z.number() }),
    z.object({ orderId: z.string(), createdAt: isoDate, total: z.number(), note: z.string().optional() }),
  ] as const,
};

const ordersFor = ([V1, V2, V3]: (typeof orderVersions)['zod'] | (typeof orderVersions)['s builder']) =>
  versioned([
    { schema: V1 },
    {
      schema: V2,
      upcast: ({ placedAt, ...rest }) => ({ ...rest, createdAt: placedAt }),
      downcast: ({ createdAt, ...rest }) => ({ ...rest, placedAt: createdAt }),
    },
    { schema: V3 },
  ]);

const placedAt = new Date('2026-10-31T10:00:00.000Z');
const orderV1 = { orderId: 'order-1', placedAt, total: 100 };
const orderV2 = { orderId: 'order-1', createdAt: placedAt, total: 100 };
const orderV3 = { orderId: 'order-1', createdAt: placedAt, total: 100, note: 'leave at the door' };

type Storage = {
  formats: FormatCodecs;
  insert: (document: JSONDocument) => Promise<void>;
  findOne: () => Promise<JSONDocument>;
};

const client = new MongoClient('mongodb://localhost:27099/versioning');
const mongoDB: Storage = {
  formats: mongoDBFormats,
  insert: async (document) => void (await client.db().collection('orders').insertOne({ ...document })),
  findOne: async () => (await client.db().collection('orders').findOne({}, { projection: { _id: 0 } }))!,
};

const pongoFile = `./pongo-versioning-${Date.now()}.db`;
const pongo = pongoClient({ connectionString: pongoFile, driver: sqlite3PongoDriver });
let pongoCollection = 0;
const pongoOrders = () => pongo.db().collection<JSONDocument>(`orders_${pongoCollection}`);
const pongoStorage: Storage = {
  formats: pongoFormats,
  insert: async (document) => void (await pongoOrders().insertOne({ ...document })),
  findOne: async () => {
    const { _id, _version, ...document } = (await pongoOrders().findOne())!;
    return document;
  },
};

before(() => client.connect());
beforeEach(async () => {
  await client.db().dropDatabase();
  pongoCollection++;
});
after(async () => {
  await client.close();
  await pongo.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${pongoFile}${suffix}`, { force: true });
});

for (const [storageName, storage] of Object.entries({ MongoDB: mongoDB, Pongo: pongoStorage })) {
  for (const [style, schemas] of Object.entries(orderVersions)) {
    describe(`${storageName}, ${style}`, () => {
      const codec = versionedCodec(ordersFor(schemas), storage.formats, { validation: { onRead: true, onWrite: true } });
      const writeAs = async (schemaVersion: number, value: JSONDocument) =>
        storage.insert(documentCodec(schemas[schemaVersion - 1]! as DocumentSchema, storage.formats).write(value));

      it('reads a version 1 document as version 3: converted with the v1 schema, then upcast to v2, then passed to v3', async () => {
        await writeAs(1, orderV1);

        assert.deepEqual(codec.read(await storage.findOne(), 1), orderV2);
      });

      it('reads a version 2 document as version 3 without an upcast for v3', async () => {
        await writeAs(2, orderV2);

        assert.deepEqual(codec.read(await storage.findOne(), 2), orderV2);
      });

      it('reads a version 3 document as it is', async () => {
        await writeAs(3, orderV3);

        assert.deepEqual(codec.read(await storage.findOne(), 3), orderV3);
      });

      it('writes the latest version by default', async () => {
        const { document, schemaVersion } = codec.write(orderV3);
        await storage.insert(document);

        assert.equal(schemaVersion, 3);
        assert.deepEqual(codec.read(await storage.findOne(), schemaVersion), orderV3);
      });

      it('writes version 1 through downcasts and reads it back as version 3', async () => {
        const { document, schemaVersion } = codec.write(orderV3, 1);
        await storage.insert(document);

        const stored = await storage.findOne();
        assert.equal(schemaVersion, 1);
        assert.equal('createdAt' in stored, false);
        assert.deepEqual(codec.read(stored, schemaVersion), orderV3);
      });

      it('rejects an unknown schema version', async () => {
        await writeAs(3, orderV3);

        assert.throws(() => codec.read({}, 4), /Unknown schema version 4/);
      });
    });
  }
}

describe('Pongo, zod: why each version needs its own schema', () => {
  it('converting a version 1 document with the latest schema leaves its date a string', async () => {
    const [V1, , V3] = orderVersions.zod;
    await pongoStorage.insert(documentCodec(V1, pongoFormats).write(orderV1));
    const stored = await pongoStorage.findOne();

    const { placedAt: convertedWithLatest } = documentCodec(V3, pongoFormats).read(stored) as unknown as typeof orderV1;
    const { placedAt: convertedWithV1 } = documentCodec(V1, pongoFormats).read(stored);

    assert.equal(convertedWithLatest, '2026-10-31T10:00:00.000Z');
    assert.deepEqual(convertedWithV1, placedAt);
  });
});

describe('two upcasts in a row', () => {
  const V1 = z.object({ orderId: z.string(), placedAt: isoDate, total: z.number() });
  const V2 = z.object({ orderId: z.string(), createdAt: isoDate, total: z.number() });
  const V3 = z.object({ orderId: z.string(), createdAt: isoDate, total: z.object({ amount: z.number(), currency: z.string() }) });

  const calls: string[] = [];
  const orders = versioned([
    { schema: V1 },
    {
      schema: V2,
      upcast: ({ placedAt, ...rest }) => (calls.push(`v1 -> v2, placedAt is ${placedAt.constructor.name}`), { ...rest, createdAt: placedAt }),
      downcast: ({ createdAt, ...rest }) => ({ ...rest, placedAt: createdAt }),
    },
    {
      schema: V3,
      upcast: ({ total, ...rest }) => (calls.push('v2 -> v3'), { ...rest, total: { amount: total, currency: 'EUR' } }),
      downcast: ({ total, ...rest }) => ({ ...rest, total: total.amount }),
    },
  ]);

  beforeEach(() => void (calls.length = 0));

  for (const [storageName, storage] of Object.entries({ MongoDB: mongoDB, Pongo: pongoStorage })) {
    const codec = versionedCodec(orders, storage.formats, { validation: { onRead: true, onWrite: true } });

    it(`${storageName}: reads version 1 as version 3 through v1 -> v2 -> v3`, async () => {
      await storage.insert(documentCodec(V1, storage.formats).write(orderV1));

      const order = codec.read(await storage.findOne(), 1);

      assert.deepEqual(calls, ['v1 -> v2, placedAt is Date', 'v2 -> v3']);
      assert.deepEqual(order, { orderId: 'order-1', createdAt: placedAt, total: { amount: 100, currency: 'EUR' } });
    });

    it(`${storageName}: reads version 2 as version 3 through v2 -> v3 only`, async () => {
      await storage.insert(documentCodec(V2, storage.formats).write(orderV2));

      codec.read(await storage.findOne(), 2);

      assert.deepEqual(calls, ['v2 -> v3']);
    });

    it(`${storageName}: writes version 3 as version 1 through v3 -> v2 -> v1`, async () => {
      const { document } = codec.write({ orderId: 'order-1', createdAt: placedAt, total: { amount: 100, currency: 'EUR' } }, 1);
      await storage.insert(document);

      assert.deepEqual(documentCodec(V1, storage.formats).read(await storage.findOne()), orderV1);
    });
  }
});

describe('one upcast function for all versions', () => {
  const V1 = z.object({ orderId: z.string(), placedAt: isoDate, total: z.number() });
  const V2 = z.object({ orderId: z.string(), createdAt: isoDate, total: z.number() });
  const V3 = z.object({ orderId: z.string(), createdAt: isoDate, total: z.object({ amount: z.number(), currency: z.string() }) });

  const calls: string[] = [];
  const orders = versioned([{ schema: V1 }, { schema: V2 }, { schema: V3 }], {
    upcast: (stored) => {
      switch (stored.schemaVersion) {
        case 1: {
          const { placedAt, total, ...rest } = stored.value;
          calls.push(`v1, placedAt is ${placedAt.constructor.name}`);
          return { ...rest, createdAt: placedAt, total: { amount: total, currency: 'EUR' } };
        }
        case 2:
          calls.push('v2');
          return { ...stored.value, total: { amount: stored.value.total, currency: 'EUR' } };
        case 3:
          calls.push('v3');
          return stored.value;
      }
    },
  });
  const expected = { orderId: 'order-1', createdAt: placedAt, total: { amount: 100, currency: 'EUR' } };

  beforeEach(() => void (calls.length = 0));

  for (const [storageName, storage] of Object.entries({ MongoDB: mongoDB, Pongo: pongoStorage })) {
    const codec = versionedCodec(orders, storage.formats, { validation: { onRead: true } });

    it(`${storageName}: gets version 1 converted with the v1 schema and returns version 3`, async () => {
      await storage.insert(documentCodec(V1, storage.formats).write(orderV1));

      assert.deepEqual(codec.read(await storage.findOne(), 1), expected);
      assert.deepEqual(calls, ['v1, placedAt is Date']);
    });

    it(`${storageName}: gets version 2 and returns version 3`, async () => {
      await storage.insert(documentCodec(V2, storage.formats).write(orderV2));

      assert.deepEqual(codec.read(await storage.findOne(), 2), expected);
      assert.deepEqual(calls, ['v2']);
    });

    it(`${storageName}: gets version 3 as it is`, async () => {
      await storage.insert(documentCodec(V3, storage.formats).write(expected));

      assert.deepEqual(codec.read(await storage.findOne(), 3), expected);
      assert.deepEqual(calls, ['v3']);
    });
  }
});
