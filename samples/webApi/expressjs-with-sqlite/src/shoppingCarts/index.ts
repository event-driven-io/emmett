import { shoppingCartApi } from './api';
import { getDetailsById, shoppingCartDetailsProjection } from './getDetails';
import {
  getShortInfoById,
  shoppingCartShortInfoProjection,
} from './getShortInfo';

export const readModel = {
  queries: {
    getShortInfoById,
    getDetailsById,
  },
  projections: [
    shoppingCartShortInfoProjection,
    shoppingCartDetailsProjection,
    //clientShoppingSummaryProjection,
  ],
};

export type ShoppingCartsReadModel = typeof readModel;

export default {
  api: shoppingCartApi,
  readModel,
};

export * from './api';
export * from './businessLogic';
export * from './shoppingCart';
