import { shoppingCartApi } from './api';
import { clientShoppingSummaryProjection } from './getClientShoppingSummary';
import { shoppingCartDetailsProjection } from './getDetails';
import { shoppingCartShortInfoProjection } from './getShortInfo';

export default {
  api: shoppingCartApi,
  projections: [
    shoppingCartShortInfoProjection,
    shoppingCartDetailsProjection,
    clientShoppingSummaryProjection,
  ],
};

export * from './api';
export * from './businessLogic';
export * from './shoppingCart';
