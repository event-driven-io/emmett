import { DurableObject } from 'cloudflare:workers';
import {
  DeciderCommandHandler,
  NotFoundError,
  projections,
  STREAM_DOES_NOT_EXIST,
  type EventStore,
} from '@event-driven-io/emmett';
import { getSQLiteEventStore } from '@event-driven-io/emmett-sqlite';
import { durableObjectEventStoreDriver } from '@event-driven-io/emmett-sqlite/cloudflare';
import {
  pongoClient,
  type PongoCollection,
  type WithIdAndVersion,
} from '@event-driven-io/pongo';
import { cloudflareDurableObjectSQLiteDriver } from '@event-driven-io/pongo/cloudflare';
import pongoConfig from '../pongo.config';
import { decider, type ShoppingCartCommand } from './businessLogic';
import {
  clientShoppingCartsProjection,
  shoppingCartsProjection,
} from './projections';
import type {
  ClientShoppingCarts,
  PricedProductItem,
  ShoppingCart,
} from './shoppingCart';

type GetCurrentShoppingCart = { clientId: string };

type GetShoppingCart = { shoppingCartId: string };

type AddProductItemToCurrentShoppingCart = {
  clientId: string;
  productItem: PricedProductItem;
  now: Date;
};

type AddProductItemToShoppingCart = {
  clientId: string;
  shoppingCartId: string;
  expectedVersion: bigint;
  productItem: PricedProductItem;
  now: Date;
};

type RemoveProductItemFromShoppingCart = {
  shoppingCartId: string;
  expectedVersion: bigint;
  productId: string;
  quantity: number;
};

type ChangeShoppingCartStatus = {
  shoppingCartId: string;
  expectedVersion: bigint;
  now: Date;
};

export const getShoppingCartEventStore = (storage: DurableObjectStorage) =>
  getSQLiteEventStore({
    driver: durableObjectEventStoreDriver,
    storage,
    projections: projections.inline([
      shoppingCartsProjection,
      clientShoppingCartsProjection,
    ]),
  });

const handle = DeciderCommandHandler(decider);

const withoutDocumentVersion = ({
  _version,
  ...cart
}: WithIdAndVersion<ShoppingCart>): ShoppingCart => cart;

export class ShoppingCartDurableObject extends DurableObject<CloudflareBindings> {
  readonly #eventStore: EventStore;
  readonly #shoppingCarts: PongoCollection<ShoppingCart>;
  readonly #clientShoppingCarts: PongoCollection<ClientShoppingCarts>;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);

    const eventStore = getShoppingCartEventStore(ctx.storage);
    this.#eventStore = eventStore;

    const client = pongoClient({
      driver: cloudflareDurableObjectSQLiteDriver,
      storage: ctx.storage,
      schema: { definition: pongoConfig.schema, autoMigration: 'None' },
      errors: { throwOnOperationFailures: true },
    });
    this.#shoppingCarts = client.database.shoppingCarts;
    this.#clientShoppingCarts = client.database.clientShoppingCarts;

    void ctx.blockConcurrencyWhile(async () => {
      await eventStore.schema.migrate();
    });
  }

  async getCurrent({ clientId }: GetCurrentShoppingCart) {
    const cart = await this.#shoppingCarts.findOne({
      clientId,
      status: 'Opened',
    });
    if (cart === null)
      throw new NotFoundError({ id: clientId, type: 'Shopping cart' });

    return withoutDocumentVersion(cart);
  }

  async getById({ shoppingCartId }: GetShoppingCart) {
    const cart = await this.#shoppingCarts.findOne({ _id: shoppingCartId });
    if (cart === null)
      throw new NotFoundError({ id: shoppingCartId, type: 'Shopping cart' });

    return withoutDocumentVersion(cart);
  }

  async addProductItemToCurrent({
    clientId,
    productItem,
    now,
  }: AddProductItemToCurrentShoppingCart) {
    const current = await this.#clientShoppingCarts.findOne({ _id: clientId });
    const isOpened = current?.status === 'Opened';
    const shoppingCartId = isOpened
      ? current.lastShoppingCartId
      : `shopping_cart-${clientId}:${(current?.lastCartNumber ?? 0) + 1}`;

    const cart = await this.#handle(
      shoppingCartId,
      {
        type: 'AddProductItemToShoppingCart',
        data: { shoppingCartId, clientId, productItem },
        metadata: { clientId, now },
      },
      isOpened ? undefined : STREAM_DOES_NOT_EXIST,
    );

    return { cart, created: !isOpened };
  }

  async addProductItem({
    clientId,
    shoppingCartId,
    expectedVersion,
    productItem,
    now,
  }: AddProductItemToShoppingCart) {
    await this.getById({ shoppingCartId });

    return this.#handle(
      shoppingCartId,
      {
        type: 'AddProductItemToShoppingCart',
        data: { shoppingCartId, clientId, productItem },
        metadata: { clientId, now },
      },
      expectedVersion,
    );
  }

  async removeProductItem({
    shoppingCartId,
    expectedVersion,
    productId,
    quantity,
  }: RemoveProductItemFromShoppingCart) {
    const { clientId } = await this.getById({ shoppingCartId });

    return this.#handle(
      shoppingCartId,
      {
        type: 'RemoveProductItemFromShoppingCart',
        data: { shoppingCartId, productId, quantity },
        metadata: { clientId, now: new Date() },
      },
      expectedVersion,
    );
  }

  async confirm({
    shoppingCartId,
    expectedVersion,
    now,
  }: ChangeShoppingCartStatus) {
    const { clientId } = await this.getById({ shoppingCartId });

    return this.#handle(
      shoppingCartId,
      {
        type: 'ConfirmShoppingCart',
        data: { shoppingCartId },
        metadata: { clientId, now },
      },
      expectedVersion,
    );
  }

  async cancel({
    shoppingCartId,
    expectedVersion,
    now,
  }: ChangeShoppingCartStatus) {
    const { clientId } = await this.getById({ shoppingCartId });

    return this.#handle(
      shoppingCartId,
      {
        type: 'CancelShoppingCart',
        data: { shoppingCartId },
        metadata: { clientId, now },
      },
      expectedVersion,
    );
  }

  async #handle(
    shoppingCartId: string,
    command: ShoppingCartCommand,
    expectedStreamVersion: bigint | typeof STREAM_DOES_NOT_EXIST | undefined,
  ): Promise<ShoppingCart> {
    const { nextExpectedStreamVersion } = await handle(
      this.#eventStore,
      shoppingCartId,
      command,
      { expectedStreamVersion },
    );

    const cart = await this.getById({ shoppingCartId });

    return { ...cart, streamPosition: nextExpectedStreamVersion };
  }
}
