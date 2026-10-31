// Inline projection state with a schema, on top of the events PoC (prototypes/api-ergonomics)
// and the real MongoDB event store. Needs MongoDB on localhost:27099.
import { projections } from '@event-driven-io/emmett';
import { getMongoDBEventStore, mongoDBInlineProjection, toStreamCollectionName } from '@event-driven-io/emmett-mongodb';
import { MongoClient, ObjectId } from 'mongodb';
import { z } from 'zod';
import { s } from '../../../prototypes/api-ergonomics/lib/index.js';
import * as A from '../../../prototypes/api-ergonomics/styles/a-builtin/shoppingCart.js';
import * as B from '../../../prototypes/api-ergonomics/styles/b-zod/shoppingCart.js';

type StateSchema = { '~standard': { validate: (value: unknown) => unknown; jsonSchema?: { input: (o: { target: string }) => Record<string, unknown> } } };

const attempt = async (label: string, fn: () => unknown) => {
  try {
    console.log(`OK    ${label}:`, JSON.stringify(await fn()));
  } catch (error) {
    console.log(`FAIL  ${label}: ${(error as Error).message.split('\n')[0]}`);
  }
};

type CartSummary = { clientId: string | ObjectId; totalAmount: number; confirmedAt?: Date };
type CartEvent = A.ProductItemAddedToShoppingCart | A.ShoppingCartConfirmed;

const evolve = (toClientId: (id: string) => string | ObjectId) => (state: CartSummary | null, event: CartEvent): CartSummary => {
  switch (event.type) {
    case 'ProductItemAddedToShoppingCart':
      return {
        clientId: toClientId(event.data.clientId),
        totalAmount: (state?.totalAmount ?? 0) + event.data.productItem.quantity * event.data.productItem.unitPrice,
      };
    case 'ShoppingCartConfirmed':
      return { ...state!, confirmedAt: event.data.confirmedAt };
  }
};

const variants: Record<string, { state: StateSchema; toClientId: (id: string) => string | ObjectId; events: typeof A | typeof B }> = {
  'a-builtin, clientId string': {
    state: s.object({ clientId: s.string(), totalAmount: s.number(), confirmedAt: s.optional(s.date()) }),
    toClientId: (id) => id,
    events: A,
  },
  'b-zod, clientId string': {
    state: z.object({ clientId: z.string(), totalAmount: z.number(), confirmedAt: B.isoDate.optional() }),
    toClientId: (id) => id,
    events: B,
  },
  'b-zod, clientId ObjectId': {
    state: z.object({ clientId: z.instanceof(ObjectId), totalAmount: z.number(), confirmedAt: z.date().optional() }),
    toClientId: (id) => new ObjectId(id),
    events: B,
  },
};

const clientId = '64f000000000000000000001';
const client = new MongoClient('mongodb://localhost:27099');
await client.connect();

for (const [name, variant] of Object.entries(variants)) {
  console.log(`--- ${name}`);
  await client.db().dropDatabase();

  const eventStore = getMongoDBEventStore({
    client,
    projections: projections.inline([
      mongoDBInlineProjection({ name: 'summary', canHandle: ['ProductItemAddedToShoppingCart', 'ShoppingCartConfirmed'], evolve: evolve(variant.toClientId) }),
    ]),
  });
  const streamName = 'shopping_cart:cart-1';
  const metadata = { clientId };
  const added = variant.events.ProductItemAddedToShoppingCart(
    { shoppingCartId: 'cart-1', clientId, productItem: { productId: 'shoes', quantity: 2, unitPrice: 50 }, addedAt: new Date() },
    metadata,
  );
  const confirmed = variant.events.ShoppingCartConfirmed({ shoppingCartId: 'cart-1', confirmedAt: new Date('2026-10-31T10:00:00.000Z') }, metadata);

  await attempt('append events, inline projection runs', async () => (await eventStore.appendToStream(streamName, [added, confirmed])).nextExpectedStreamVersion.toString());

  const collection = client.db().collection(toStreamCollectionName('shopping_cart'));
  await attempt('BSON types stored in projections.summary', async () =>
    (await collection.aggregate([{ $match: { streamName } }, { $project: { _id: 0, clientId: { $type: '$projections.summary.clientId' }, confirmedAt: { $type: '$projections.summary.confirmedAt' } } }]).toArray())[0],
  );

  const stored = await eventStore.projections.inline.findOne<CartSummary & { _metadata?: unknown }>({ streamType: 'shopping_cart', projectionName: 'summary' });
  const { _metadata, ...state } = stored ?? {};
  await attempt('state schema validates the stored state', () => {
    const result = variant.state['~standard'].validate(state) as { issues?: { message: string; path?: unknown[] }[] };
    if (result.issues) throw new Error(result.issues.map((i) => `${JSON.stringify(i.path)} ${i.message}`).join('; '));
    return 'valid';
  });

  let jsonSchema: Record<string, unknown> | undefined;
  await attempt('state schema to JSON Schema', () => (jsonSchema = variant.state['~standard'].jsonSchema!.input({ target: 'draft-2020-12' })));
  await attempt('that JSON Schema as MongoDB validator at projections.summary (collMod)', () =>
    client.db().command({
      collMod: toStreamCollectionName('shopping_cart'),
      validator: { $jsonSchema: { bsonType: 'object', properties: { projections: { bsonType: 'object', properties: { summary: jsonSchema } } } } },
    }),
  );

  await attempt('findOne by clientId as string', async () => !!(await eventStore.projections.inline.findOne({ streamType: 'shopping_cart', projectionName: 'summary' }, { clientId })));
  await attempt('findOne by clientId as ObjectId', async () =>
    !!(await eventStore.projections.inline.findOne({ streamType: 'shopping_cart', projectionName: 'summary' }, { clientId: new ObjectId(clientId) })),
  );
  await client.db().dropDatabase();
}

await client.close();
