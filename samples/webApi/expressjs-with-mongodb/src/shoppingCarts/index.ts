import { shoppingCartApi } from './api';
import { shoppingCartDetailsProjection } from './getDetails';
import { shoppingCartShortInfoProjection } from './getShortInfo';

export default {
  api: shoppingCartApi,
  projections: [shoppingCartShortInfoProjection, shoppingCartDetailsProjection],
};

export * from './api';
export * from './businessLogic';
export * from './shoppingCart';
