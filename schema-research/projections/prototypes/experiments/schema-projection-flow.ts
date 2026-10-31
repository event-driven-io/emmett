// The proposed flow, end to end, on the events PoC (prototypes/api-ergonomics) and the real
// MongoDB event store. Needs MongoDB on localhost:27099.
import { projections } from '@event-driven-io/emmett';
import { getMongoDBEventStore, type MongoDBEventStore } from '@event-driven-io/emmett-mongodb';
import { MongoClient, ObjectId } from 'mongodb';
import { z } from 'zod';
import { s } from '../../../prototypes/api-ergonomics/lib/index.js';
import * as A from '../../../prototypes/api-ergonomics/styles/a-builtin/shoppingCart.js';
import * as B from '../../../prototypes/api-ergonomics/styles/b-zod/shoppingCart.js';
import { inlineProjectionValidator, mongoDBFormats, mongoDBSchemaInlineProjection, objectId } from '../lib/mongoDBSchema.js';
import { documentCodec, type DocumentSchema } from '../lib/projectionSchema.js';

const attempt = async (label: string, fn: () => unknown) => {
  try {
    console.log(`OK    ${label}:`, JSON.stringify(await fn()));
  } catch (error) {
    console.log(`FAIL  ${label}: ${(error as Error).message.split('\n')[0]}`);
  }
};

type CartSummary = { clientId: string; totalAmount: number; confirmedAt?: Date | undefined };
type CartEvent = A.ProductItemAddedToShoppingCart | A.ShoppingCartConfirmed;

const evolve = (state: CartSummary | null, event: CartEvent): CartSummary => {
  switch (event.type) {
    case 'ProductItemAddedToShoppingCart':
      return {
        clientId: event.data.clientId,
        totalAmount: (state?.totalAmount ?? 0) + event.data.productItem.quantity * event.data.productItem.unitPrice,
      };
    case 'ShoppingCartConfirmed':
      return { ...state!, confirmedAt: event.data.confirmedAt };
  }
};

const variants: Record<string, { schema: DocumentSchema<CartSummary>; events: typeof A | typeof B }> = {
  's builder': {
    schema: s.object({ clientId: objectId(), totalAmount: s.number(), confirmedAt: s.optional(s.date()) }),
    events: A,
  },
  zod: {
    schema: z.object({
      clientId: z.stringFormat('objectid', /^[0-9a-f]{24}$/),
      totalAmount: z.number(),
      confirmedAt: B.isoDate.optional(),
    }),
    events: B,
  },
};

const clientId = '64f000000000000000000001';
const client = new MongoClient('mongodb://localhost:27099');
await client.connect();

for (const [name, { schema, events }] of Object.entries(variants)) {
  console.log(`--- ${name}`);
  await client.db().dropDatabase();
  const codec = documentCodec(schema, mongoDBFormats, { validation: { onWrite: true } });
  const eventStore: MongoDBEventStore = getMongoDBEventStore({
    client,
    projections: projections.inline([
      mongoDBSchemaInlineProjection({ name: 'summary', schema, validation: { onWrite: true }, canHandle: ['ProductItemAddedToShoppingCart', 'ShoppingCartConfirmed'], evolve }),
    ]),
  });
  const collection = await eventStore.collectionFor('shopping_cart');
  const metadata = { clientId };

  await attempt('paths found by format', () => codec.paths);
  await attempt('set derived validator on the stream collection', async () => {
    const validator = inlineProjectionValidator({ name: 'summary', schema });
    await client.db().command({ collMod: collection.collectionName, validator, validationAction: 'error' });
    return validator.$jsonSchema.properties.projections.properties.summary;
  });

  await attempt('append ProductItemAdded (evolve gets null)', async () =>
    (await eventStore.appendToStream('shopping_cart:cart-1', [
      events.ProductItemAddedToShoppingCart({ shoppingCartId: 'cart-1', clientId, productItem: { productId: 'shoes', quantity: 2, unitPrice: 50 }, addedAt: new Date() }, metadata),
    ])).nextExpectedStreamVersion.toString(),
  );
  await attempt('append ShoppingCartConfirmed (evolve gets the stored state, read through the codec)', async () =>
    (await eventStore.appendToStream('shopping_cart:cart-1', [
      events.ShoppingCartConfirmed({ shoppingCartId: 'cart-1', confirmedAt: new Date('2026-10-31T10:00:00.000Z') }, metadata),
    ])).nextExpectedStreamVersion.toString(),
  );

  await attempt('BSON types stored', async () =>
    (await collection.aggregate([{ $project: { _id: 0, clientId: { $type: '$projections.summary.clientId' }, confirmedAt: { $type: '$projections.summary.confirmedAt' } } }]).toArray())[0],
  );

  await attempt('read: what the code sees', async () => {
    const stored = await eventStore.projections.inline.findOne<CartSummary & { _metadata?: unknown }>({ streamType: 'shopping_cart', projectionName: 'summary' });
    const { _metadata, ...state } = stored!;
    const value = codec.read(state);
    return { clientId: typeof value.clientId, totalAmount: value.totalAmount, confirmedAt: value.confirmedAt instanceof Date ? 'Date' : typeof value.confirmedAt };
  });

  await attempt('query: filter as the code writes it, through codec.filter', () => codec.filter({ clientId }));
  await attempt('query through eventStore.projections.inline.findOne', async () =>
    !!(await eventStore.projections.inline.findOne({ streamType: 'shopping_cart', projectionName: 'summary' }, codec.filter({ clientId }))),
  );
  await attempt('query through the collection with the prefix written by hand', async () =>
    collection.countDocuments({ 'projections.summary.clientId': codec.filter({ clientId }).clientId }),
  );

  await attempt('write: codec rejects a wrong value before MongoDB', () => codec.write({ clientId, totalAmount: 'a lot' } as unknown as CartSummary));
  await attempt('write: MongoDB validator rejects a string clientId written past the codec', async () =>
    (await collection.updateOne({}, { $set: { 'projections.summary.clientId': clientId } })).modifiedCount,
  );
}

await client.close();
