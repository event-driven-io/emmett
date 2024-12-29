/* eslint-disable @typescript-eslint/no-unused-vars */
import type { ShoppingCartEvent } from '../events';
import { shoppingCartApi } from './simpleApi';

// #region given
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import {
  ApiSpecification,
  getApplication,
} from '@event-driven-io/emmett-expressjs';

const unitPrice = 100;
const now = new Date();

const given = ApiSpecification.for<ShoppingCartEvent>(
  () => getInMemoryEventStore(),
  (eventStore) =>
    getApplication({
      apis: [
        shoppingCartApi(
          eventStore,
          () => Promise.resolve(unitPrice),
          () => now,
        ),
      ],
    }),
);
// #endregion given
