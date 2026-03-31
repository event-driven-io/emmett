/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  NoContent,
  NotFound,
  OK,
  on,
  type WebApiSetup,
} from '@event-driven-io/emmett-expressjs';
import type { PongoDb } from '@event-driven-io/pongo';
import type { Request, Router } from 'express';

type ShoppingCartShortInfo = {
  productItemsCount: number;
  totalAmount: number;
};

type ShoppingCartDetails = {
  clientId: string;
  productItemsCount: number;
  totalAmount: number;
  status: 'Opened' | 'Confirmed' | 'Cancelled';
  openedAt: Date;
  confirmedAt?: Date | undefined;
  cancelledAt?: Date | undefined;
};

const shoppingCartShortInfoCollectionName = 'shoppingCartShortInfo';
const shoppingCartDetailsCollectionName = 'shoppingCartDetails';

// #region querying-read-models
const getShortInfoById = (
  db: PongoDb,
  shoppingCartId: string,
): Promise<ShoppingCartShortInfo | null> =>
  db
    .collection<ShoppingCartShortInfo>(shoppingCartShortInfoCollectionName)
    .findOne({ _id: shoppingCartId });

const getDetailsById = (
  db: PongoDb,
  shoppingCartId: string,
): Promise<ShoppingCartDetails | null> =>
  db
    .collection<ShoppingCartDetails>(shoppingCartDetailsCollectionName)
    .findOne({ _id: shoppingCartId });
// #endregion querying-read-models

// #region api-routes
const shoppingCartApi =
  (readStore: PongoDb): WebApiSetup =>
  (router: Router) => {
    router.get(
      '/clients/:clientId/shopping-carts/current',
      on(async (request: Request) => {
        const shoppingCartId = `shopping_cart:${request.params.clientId}:current`;

        const result = await getDetailsById(readStore, shoppingCartId);

        if (result === null) return NotFound();

        if (result.status !== 'Opened') return NotFound();

        return OK({ body: result });
      }),
    );

    router.get(
      '/clients/:clientId/shopping-carts/current/short-info',
      on(async (request: Request) => {
        const shoppingCartId = `shopping_cart:${request.params.clientId}:current`;

        const result = await getShortInfoById(readStore, shoppingCartId);

        if (result === null) return NotFound();

        return OK({ body: result });
      }),
    );
  };
// #endregion api-routes
