import { shoppingCartApi } from './api';
import { shoppingCartShortInfoProjection } from './getShortInfo';

export default {
  api: shoppingCartApi,
  projections: [shoppingCartShortInfoProjection],
};

export * from './api';
export * from './businessLogic';
export * from './shoppingCart';
