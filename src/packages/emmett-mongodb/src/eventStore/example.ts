import type { Event } from '@event-driven-io/emmett';
import { MongoClient } from 'mongodb';
import { getMongoDBEventStore } from '../eventStore';

export type PricedProductItem = {
  productId: string;
  quantity: number;
  price: number;
};
export type ProductItemAdded = Event<
  'ProductItemAdded',
  { productItem: PricedProductItem }
>;
export type DiscountApplied = Event<
  'DiscountApplied',
  { percent: number; couponId: string }
>;

export type ShoppingCartEvent = ProductItemAdded | DiscountApplied;

const connectionString = `mongodb://localhost:30003,localhost:30004/ylah-access?replicaSet=rsmongo&retryWrites=true&w=majority`;

const main = async () => {
  const mongo = new MongoClient(connectionString);
  await mongo.connect();
  const es = getMongoDBEventStore({
    client: mongo,
  });
  await es.appendToStream<ShoppingCartEvent>('test', [
    {
      type: 'ProductItemAdded',
      data: {
        productItem: {
          price: 100,
          productId: '111-000',
          quantity: 1,
        },
      },
    },
  ]);
  process.on('SIGTERM', async () => {
    console.info(`Closing...`);
    await mongo.close();
  });
};

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();
