import { shoppingCartApi } from './api';
import { clientShoppingSummaryProjection } from './getClientShoppingSummary';
import { shoppingCartDetailsProjection } from './getDetails';
import { shoppingCartShortInfoProjection } from './getShortInfo';
import { shoppingCartUI } from './ui';

export default {
  api: shoppingCartApi,
  ui: shoppingCartUI,
  projections: [
    shoppingCartShortInfoProjection,
    shoppingCartDetailsProjection,
    clientShoppingSummaryProjection,
  ],
};

export * from './api';
export * from './application';
export * from './businessLogic';
export * from './shoppingCart';
export * from './ui';
