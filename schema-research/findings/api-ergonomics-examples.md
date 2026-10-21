# API ergonomics: full shopping-cart examples per style

Generated from the type-checked files in [prototypes/api-ergonomics/styles/](../prototypes/api-ergonomics/styles/), so the code below is exactly what compiled with TypeScript 6.0.3 and 7.0.2. Each style shows the imports, the event definitions (from `shoppingCart.ts`) and the command definitions (from `businessLogic.ts`). The analysis is in [api-ergonomics.md](api-ergonomics.md).

The business logic (`evolve`, `decide`, the command handler) is the same in A, B, B2, B3, B4, B5, C and E; A differs from today only in calling factories instead of returning object literals. D and F differ, so their business logic is shown too. The diffs are in `prototypes/api-ergonomics/results/diff-*.txt`.

## Today (type-only, no schema)

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/today/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/today/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/today/usage.ts)

### Events

```ts
import type { Event } from '@event-driven-io/emmett';

export type ShoppingCartEventMetadata = { clientId: string };

export type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    clientId: string;
    productItem: PricedProductItem;
    addedAt: Date;
  },
  ShoppingCartEventMetadata
>;

export type ProductItemRemovedFromShoppingCart = Event<
  'ProductItemRemovedFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    removedAt: Date;
  },
  ShoppingCartEventMetadata
>;

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  {
    shoppingCartId: string;
    confirmedAt: Date;
  },
  ShoppingCartEventMetadata
>;

export type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  {
    shoppingCartId: string;
    cancelledAt: Date;
  },
  ShoppingCartEventMetadata
>;

export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;

export interface ProductItem {
  productId: string;
  quantity: number;
}

export type PricedProductItem = ProductItem & {
  unitPrice: number;
};
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Command,
  type Decider,
  type DefaultCommandMetadata,
} from '@event-driven-io/emmett';
import {
  evolve,
  initialState,
  type PricedProductItem,
  type ProductItemAddedToShoppingCart,
  type ProductItemRemovedFromShoppingCart,
  type ShoppingCart,
  type ShoppingCartCancelled,
  type ShoppingCartConfirmed,
  type ShoppingCartEvent,
} from './shoppingCart';

export type ShoppingCartCommandMetadata = DefaultCommandMetadata & {
  clientId: string;
};

export type AddProductItemToShoppingCart = Command<
  'AddProductItemToShoppingCart',
  {
    clientId: string;
    shoppingCartId: string;
    productItem: PricedProductItem;
  },
  ShoppingCartCommandMetadata
>;

export type RemoveProductItemFromShoppingCart = Command<
  'RemoveProductItemFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  },
  ShoppingCartCommandMetadata
>;

export type ConfirmShoppingCart = Command<
  'ConfirmShoppingCart',
  {
    shoppingCartId: string;
  },
  ShoppingCartCommandMetadata
>;

export type CancelShoppingCart = Command<
  'CancelShoppingCart',
  {
    shoppingCartId: string;
  },
  ShoppingCartCommandMetadata
>;

export type ShoppingCartCommand =
  | AddProductItemToShoppingCart
  | RemoveProductItemFromShoppingCart
  | ConfirmShoppingCart
  | CancelShoppingCart;
```

### Business logic

```ts
export const addProductItem = (
  command: AddProductItemToShoppingCart,
  state: ShoppingCart,
): ProductItemAddedToShoppingCart => {
  if (state.status === 'Closed')
    throw new IllegalStateError('Shopping Cart already closed');

  const {
    data: { shoppingCartId, clientId, productItem },
    metadata,
  } = command;

  return {
    type: 'ProductItemAddedToShoppingCart',
    data: {
      shoppingCartId,
      clientId,
      productItem,
      addedAt: metadata.now,
    },
    metadata: { clientId: metadata.clientId },
  };
};

export const removeProductItem = (
  command: RemoveProductItemFromShoppingCart,
  state: ShoppingCart,
): ProductItemRemovedFromShoppingCart => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId, productItem },
    metadata,
  } = command;

  const currentQuantity = state.productItems.get(productItem.productId) ?? 0;

  if (currentQuantity < productItem.quantity)
    throw new IllegalStateError('Not enough products');

  return {
    type: 'ProductItemRemovedFromShoppingCart',
    data: {
      shoppingCartId,
      productItem,
      removedAt: metadata.now,
    },
    metadata: { clientId: metadata.clientId },
  };
};

export const confirm = (
  command: ConfirmShoppingCart,
  state: ShoppingCart,
): ShoppingCartConfirmed => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const totalQuantityOfAllProductItems = sum(state.productItems.values());

  if (totalQuantityOfAllProductItems <= 0)
    throw new IllegalStateError('Shopping Cart is empty');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return {
    type: 'ShoppingCartConfirmed',
    data: {
      shoppingCartId,
      confirmedAt: metadata.now,
    },
    metadata: { clientId: metadata.clientId },
  };
};

export const cancel = (
  command: CancelShoppingCart,
  state: ShoppingCart,
): ShoppingCartCancelled => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return {
    type: 'ShoppingCartCancelled',
    data: {
      shoppingCartId,
      cancelledAt: metadata.now,
    },
    metadata: { clientId: metadata.clientId },
  };
};

export const decide = (command: ShoppingCartCommand, state: ShoppingCart) => {
  const { type } = command;

  switch (type) {
    case 'AddProductItemToShoppingCart':
      return addProductItem(command, state);
    case 'RemoveProductItemFromShoppingCart':
      return removeProductItem(command, state);
    case 'ConfirmShoppingCart':
      return confirm(command, state);
    case 'CancelShoppingCart':
      return cancel(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
};

export const decider: Decider<
  ShoppingCart,
  ShoppingCartCommand,
  ShoppingCartEvent
> = {
  decide,
  evolve,
  initialState,
};
```

## A. Built-in builder `s`, `typeof X.Type`

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/a-builtin/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/a-builtin/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/a-builtin/usage.ts)

### Events

```ts
import { Event, Events, s } from '../../lib';

export const ProductItem = s.object({
  productId: s.string(),
  quantity: s.number(),
});
export type ProductItem = typeof ProductItem.Type;

export const PricedProductItem = ProductItem.extend({
  unitPrice: s.number(),
});
export type PricedProductItem = typeof PricedProductItem.Type;

export const ShoppingCartEventMetadata = s.object({ clientId: s.string() });
export type ShoppingCartEventMetadata = typeof ShoppingCartEventMetadata.Type;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      clientId: s.string(),
      productItem: PricedProductItem,
      addedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemAddedToShoppingCart =
  typeof ProductItemAddedToShoppingCart.Type;

export const ProductItemRemovedFromShoppingCart = Event(
  'ProductItemRemovedFromShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
      removedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemRemovedFromShoppingCart =
  typeof ProductItemRemovedFromShoppingCart.Type;

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: {
    shoppingCartId: s.string(),
    confirmedAt: s.date(),
  },
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: {
    shoppingCartId: s.string(),
    cancelledAt: s.date(),
  },
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartCancelled = typeof ShoppingCartCancelled.Type;

export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { Command, Commands, s } from '../../lib';
import {
  evolve,
  initialState,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const ShoppingCartCommandMetadata = s.object({
  now: s.date(),
  clientId: s.string(),
});
export type ShoppingCartCommandMetadata =
  typeof ShoppingCartCommandMetadata.Type;

export const AddProductItemToShoppingCart = Command(
  'AddProductItemToShoppingCart',
  {
    data: {
      clientId: s.string(),
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    metadata: ShoppingCartCommandMetadata,
  },
);
export type AddProductItemToShoppingCart =
  typeof AddProductItemToShoppingCart.Type;

export const RemoveProductItemFromShoppingCart = Command(
  'RemoveProductItemFromShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    metadata: ShoppingCartCommandMetadata,
  },
);
export type RemoveProductItemFromShoppingCart =
  typeof RemoveProductItemFromShoppingCart.Type;

export const ConfirmShoppingCart = Command('ConfirmShoppingCart', {
  data: {
    shoppingCartId: s.string(),
  },
  metadata: ShoppingCartCommandMetadata,
});
export type ConfirmShoppingCart = typeof ConfirmShoppingCart.Type;

export const CancelShoppingCart = Command('CancelShoppingCart', {
  data: {
    shoppingCartId: s.string(),
  },
  metadata: ShoppingCartCommandMetadata,
});
export type CancelShoppingCart = typeof CancelShoppingCart.Type;

export const ShoppingCartCommand = Commands(
  AddProductItemToShoppingCart,
  RemoveProductItemFromShoppingCart,
  ConfirmShoppingCart,
  CancelShoppingCart,
);
export type ShoppingCartCommand = typeof ShoppingCartCommand.Type;
```

### Business logic

```ts
export const addProductItem = (
  command: AddProductItemToShoppingCart,
  state: ShoppingCart,
): ProductItemAddedToShoppingCart => {
  if (state.status === 'Closed')
    throw new IllegalStateError('Shopping Cart already closed');

  const {
    data: { shoppingCartId, clientId, productItem },
    metadata,
  } = command;

  return ProductItemAddedToShoppingCart(
    { shoppingCartId, clientId, productItem, addedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const removeProductItem = (
  command: RemoveProductItemFromShoppingCart,
  state: ShoppingCart,
): ProductItemRemovedFromShoppingCart => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId, productItem },
    metadata,
  } = command;

  const currentQuantity = state.productItems.get(productItem.productId) ?? 0;

  if (currentQuantity < productItem.quantity)
    throw new IllegalStateError('Not enough products');

  return ProductItemRemovedFromShoppingCart(
    { shoppingCartId, productItem, removedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const confirm = (
  command: ConfirmShoppingCart,
  state: ShoppingCart,
): ShoppingCartConfirmed => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const totalQuantityOfAllProductItems = sum(state.productItems.values());

  if (totalQuantityOfAllProductItems <= 0)
    throw new IllegalStateError('Shopping Cart is empty');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return ShoppingCartConfirmed(
    { shoppingCartId, confirmedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const cancel = (
  command: CancelShoppingCart,
  state: ShoppingCart,
): ShoppingCartCancelled => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return ShoppingCartCancelled(
    { shoppingCartId, cancelledAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const decide = (command: ShoppingCartCommand, state: ShoppingCart) => {
  const { type } = command;

  switch (type) {
    case 'AddProductItemToShoppingCart':
      return addProductItem(command, state);
    case 'RemoveProductItemFromShoppingCart':
      return removeProductItem(command, state);
    case 'ConfirmShoppingCart':
      return confirm(command, state);
    case 'CancelShoppingCart':
      return cancel(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
};

export const decider: Decider<
  ShoppingCart,
  ShoppingCartCommand,
  ShoppingCartEvent
> = {
  decide,
  evolve,
  initialState,
};
```

## B. Zod

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/b-zod/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/b-zod/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/b-zod/usage.ts)

### Events

```ts
import { z } from 'zod';
import { Event, Events } from '../../lib';

// JSON has no Date: ISO 8601 string on the wire, Date in code.
export const isoDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (iso) => new Date(iso),
  encode: (date) => date.toISOString(),
});

export const ProductItem = z.object({
  productId: z.string(),
  quantity: z.number(),
});
export type ProductItem = z.infer<typeof ProductItem>;

export const PricedProductItem = ProductItem.extend({
  unitPrice: z.number(),
});
export type PricedProductItem = z.infer<typeof PricedProductItem>;

export const ShoppingCartEventMetadata = z.object({ clientId: z.string() });
export type ShoppingCartEventMetadata = z.infer<
  typeof ShoppingCartEventMetadata
>;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: z.object({
      shoppingCartId: z.string(),
      clientId: z.string(),
      productItem: PricedProductItem,
      addedAt: isoDate,
    }),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemAddedToShoppingCart =
  typeof ProductItemAddedToShoppingCart.Type;

export const ProductItemRemovedFromShoppingCart = Event(
  'ProductItemRemovedFromShoppingCart',
  {
    data: z.object({
      shoppingCartId: z.string(),
      productItem: PricedProductItem,
      removedAt: isoDate,
    }),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemRemovedFromShoppingCart =
  typeof ProductItemRemovedFromShoppingCart.Type;

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: z.object({
    shoppingCartId: z.string(),
    confirmedAt: isoDate,
  }),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: z.object({
    shoppingCartId: z.string(),
    cancelledAt: isoDate,
  }),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartCancelled = typeof ShoppingCartCancelled.Type;

export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { z } from 'zod';
import { Command, Commands } from '../../lib';
import {
  evolve,
  initialState,
  isoDate,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const ShoppingCartCommandMetadata = z.object({
  now: isoDate,
  clientId: z.string(),
});
export type ShoppingCartCommandMetadata = z.infer<
  typeof ShoppingCartCommandMetadata
>;

export const AddProductItemToShoppingCart = Command(
  'AddProductItemToShoppingCart',
  {
    data: z.object({
      clientId: z.string(),
      shoppingCartId: z.string(),
      productItem: PricedProductItem,
    }),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type AddProductItemToShoppingCart =
  typeof AddProductItemToShoppingCart.Type;

export const RemoveProductItemFromShoppingCart = Command(
  'RemoveProductItemFromShoppingCart',
  {
    data: z.object({
      shoppingCartId: z.string(),
      productItem: PricedProductItem,
    }),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type RemoveProductItemFromShoppingCart =
  typeof RemoveProductItemFromShoppingCart.Type;

export const ConfirmShoppingCart = Command('ConfirmShoppingCart', {
  data: z.object({
    shoppingCartId: z.string(),
  }),
  metadata: ShoppingCartCommandMetadata,
});
export type ConfirmShoppingCart = typeof ConfirmShoppingCart.Type;

export const CancelShoppingCart = Command('CancelShoppingCart', {
  data: z.object({
    shoppingCartId: z.string(),
  }),
  metadata: ShoppingCartCommandMetadata,
});
export type CancelShoppingCart = typeof CancelShoppingCart.Type;

export const ShoppingCartCommand = Commands(
  AddProductItemToShoppingCart,
  RemoveProductItemFromShoppingCart,
  ConfirmShoppingCart,
  CancelShoppingCart,
);
export type ShoppingCartCommand = typeof ShoppingCartCommand.Type;
```

## B2. Valibot

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/b2-valibot/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/b2-valibot/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/b2-valibot/usage.ts)

### Events

```ts
import * as v from 'valibot';
import { Event, Events } from '../../lib';

// JSON has no Date: ISO 8601 string on the wire, Date in code.
export const isoDate = v.pipe(
  v.string(),
  v.isoTimestamp(),
  v.transform((iso) => new Date(iso)),
);

export const ProductItem = v.object({
  productId: v.string(),
  quantity: v.number(),
});
export type ProductItem = v.InferOutput<typeof ProductItem>;

export const PricedProductItem = v.object({
  ...ProductItem.entries,
  unitPrice: v.number(),
});
export type PricedProductItem = v.InferOutput<typeof PricedProductItem>;

export const ShoppingCartEventMetadata = v.object({
  clientId: v.string(),
});
export type ShoppingCartEventMetadata = v.InferOutput<
  typeof ShoppingCartEventMetadata
>;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: v.object({
      shoppingCartId: v.string(),
      clientId: v.string(),
      productItem: PricedProductItem,
      addedAt: isoDate,
    }),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemAddedToShoppingCart =
  typeof ProductItemAddedToShoppingCart.Type;

export const ProductItemRemovedFromShoppingCart = Event(
  'ProductItemRemovedFromShoppingCart',
  {
    data: v.object({
      shoppingCartId: v.string(),
      productItem: PricedProductItem,
      removedAt: isoDate,
    }),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemRemovedFromShoppingCart =
  typeof ProductItemRemovedFromShoppingCart.Type;

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: v.object({
    shoppingCartId: v.string(),
    confirmedAt: isoDate,
  }),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: v.object({
    shoppingCartId: v.string(),
    cancelledAt: isoDate,
  }),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartCancelled = typeof ShoppingCartCancelled.Type;

export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import * as v from 'valibot';
import { Command, Commands } from '../../lib';
import {
  evolve,
  initialState,
  isoDate,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const ShoppingCartCommandMetadata = v.object({
  now: isoDate,
  clientId: v.string(),
});
export type ShoppingCartCommandMetadata = v.InferOutput<
  typeof ShoppingCartCommandMetadata
>;

export const AddProductItemToShoppingCart = Command(
  'AddProductItemToShoppingCart',
  {
    data: v.object({
      clientId: v.string(),
      shoppingCartId: v.string(),
      productItem: PricedProductItem,
    }),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type AddProductItemToShoppingCart =
  typeof AddProductItemToShoppingCart.Type;

export const RemoveProductItemFromShoppingCart = Command(
  'RemoveProductItemFromShoppingCart',
  {
    data: v.object({
      shoppingCartId: v.string(),
      productItem: PricedProductItem,
    }),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type RemoveProductItemFromShoppingCart =
  typeof RemoveProductItemFromShoppingCart.Type;

export const ConfirmShoppingCart = Command('ConfirmShoppingCart', {
  data: v.object({
    shoppingCartId: v.string(),
  }),
  metadata: ShoppingCartCommandMetadata,
});
export type ConfirmShoppingCart = typeof ConfirmShoppingCart.Type;

export const CancelShoppingCart = Command('CancelShoppingCart', {
  data: v.object({
    shoppingCartId: v.string(),
  }),
  metadata: ShoppingCartCommandMetadata,
});
export type CancelShoppingCart = typeof CancelShoppingCart.Type;

export const ShoppingCartCommand = Commands(
  AddProductItemToShoppingCart,
  RemoveProductItemFromShoppingCart,
  ConfirmShoppingCart,
  CancelShoppingCart,
);
export type ShoppingCartCommand = typeof ShoppingCartCommand.Type;
```

## B3. ArkType

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/b3-arktype/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/b3-arktype/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/b3-arktype/usage.ts)

### Events

```ts
import { type } from 'arktype';
import { Event, Events } from '../../lib';

// JSON has no Date: ISO 8601 string on the wire, Date in code.
export const isoDate = type('string.date.iso.parse');

export const ProductItem = type({
  productId: 'string',
  quantity: 'number',
});
export type ProductItem = typeof ProductItem.infer;

export const PricedProductItem = ProductItem.merge({
  unitPrice: 'number',
});
export type PricedProductItem = typeof PricedProductItem.infer;

export const ShoppingCartEventMetadata = type({
  clientId: 'string',
});
export type ShoppingCartEventMetadata = typeof ShoppingCartEventMetadata.infer;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: type({
      shoppingCartId: 'string',
      clientId: 'string',
      productItem: PricedProductItem,
      addedAt: isoDate,
    }),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemAddedToShoppingCart =
  typeof ProductItemAddedToShoppingCart.Type;

export const ProductItemRemovedFromShoppingCart = Event(
  'ProductItemRemovedFromShoppingCart',
  {
    data: type({
      shoppingCartId: 'string',
      productItem: PricedProductItem,
      removedAt: isoDate,
    }),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemRemovedFromShoppingCart =
  typeof ProductItemRemovedFromShoppingCart.Type;

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: type({
    shoppingCartId: 'string',
    confirmedAt: isoDate,
  }),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: type({
    shoppingCartId: 'string',
    cancelledAt: isoDate,
  }),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartCancelled = typeof ShoppingCartCancelled.Type;

export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { type } from 'arktype';
import { Command, Commands } from '../../lib';
import {
  evolve,
  initialState,
  isoDate,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const ShoppingCartCommandMetadata = type({
  now: isoDate,
  clientId: 'string',
});
export type ShoppingCartCommandMetadata =
  typeof ShoppingCartCommandMetadata.infer;

export const AddProductItemToShoppingCart = Command(
  'AddProductItemToShoppingCart',
  {
    data: type({
      clientId: 'string',
      shoppingCartId: 'string',
      productItem: PricedProductItem,
    }),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type AddProductItemToShoppingCart =
  typeof AddProductItemToShoppingCart.Type;

export const RemoveProductItemFromShoppingCart = Command(
  'RemoveProductItemFromShoppingCart',
  {
    data: type({
      shoppingCartId: 'string',
      productItem: PricedProductItem,
    }),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type RemoveProductItemFromShoppingCart =
  typeof RemoveProductItemFromShoppingCart.Type;

export const ConfirmShoppingCart = Command('ConfirmShoppingCart', {
  data: type({
    shoppingCartId: 'string',
  }),
  metadata: ShoppingCartCommandMetadata,
});
export type ConfirmShoppingCart = typeof ConfirmShoppingCart.Type;

export const CancelShoppingCart = Command('CancelShoppingCart', {
  data: type({
    shoppingCartId: 'string',
  }),
  metadata: ShoppingCartCommandMetadata,
});
export type CancelShoppingCart = typeof CancelShoppingCart.Type;

export const ShoppingCartCommand = Commands(
  AddProductItemToShoppingCart,
  RemoveProductItemFromShoppingCart,
  ConfirmShoppingCart,
  CancelShoppingCart,
);
export type ShoppingCartCommand = typeof ShoppingCartCommand.Type;
```

## B4. Effect

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/b4-effect/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/b4-effect/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/b4-effect/usage.ts)

### Events

```ts
import { Schema } from 'effect';
import { Event, Events } from '../../lib';

// JSON has no Date: ISO 8601 string on the wire, Date in code.
export const isoDate = Schema.DateFromString;

export const ProductItem = Schema.Struct({
  productId: Schema.String,
  quantity: Schema.Number,
});
export type ProductItem = typeof ProductItem.Type;

export const PricedProductItem = Schema.Struct({
  ...ProductItem.fields,
  unitPrice: Schema.Number,
});
export type PricedProductItem = typeof PricedProductItem.Type;

export const ShoppingCartEventMetadata = Schema.toStandardSchemaV1(
  Schema.Struct({
    clientId: Schema.String,
  }),
);
export type ShoppingCartEventMetadata = typeof ShoppingCartEventMetadata.Type;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: Schema.toStandardSchemaV1(
      Schema.Struct({
        shoppingCartId: Schema.String,
        clientId: Schema.String,
        productItem: PricedProductItem,
        addedAt: isoDate,
      }),
    ),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemAddedToShoppingCart =
  typeof ProductItemAddedToShoppingCart.Type;

export const ProductItemRemovedFromShoppingCart = Event(
  'ProductItemRemovedFromShoppingCart',
  {
    data: Schema.toStandardSchemaV1(
      Schema.Struct({
        shoppingCartId: Schema.String,
        productItem: PricedProductItem,
        removedAt: isoDate,
      }),
    ),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemRemovedFromShoppingCart =
  typeof ProductItemRemovedFromShoppingCart.Type;

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: Schema.toStandardSchemaV1(
    Schema.Struct({
      shoppingCartId: Schema.String,
      confirmedAt: isoDate,
    }),
  ),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: Schema.toStandardSchemaV1(
    Schema.Struct({
      shoppingCartId: Schema.String,
      cancelledAt: isoDate,
    }),
  ),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartCancelled = typeof ShoppingCartCancelled.Type;

export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { Schema } from 'effect';
import { Command, Commands } from '../../lib';
import {
  evolve,
  initialState,
  isoDate,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const ShoppingCartCommandMetadata = Schema.toStandardSchemaV1(
  Schema.Struct({
    now: isoDate,
    clientId: Schema.String,
  }),
);
export type ShoppingCartCommandMetadata =
  typeof ShoppingCartCommandMetadata.Type;

export const AddProductItemToShoppingCart = Command(
  'AddProductItemToShoppingCart',
  {
    data: Schema.toStandardSchemaV1(
      Schema.Struct({
        clientId: Schema.String,
        shoppingCartId: Schema.String,
        productItem: PricedProductItem,
      }),
    ),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type AddProductItemToShoppingCart =
  typeof AddProductItemToShoppingCart.Type;

export const RemoveProductItemFromShoppingCart = Command(
  'RemoveProductItemFromShoppingCart',
  {
    data: Schema.toStandardSchemaV1(
      Schema.Struct({
        shoppingCartId: Schema.String,
        productItem: PricedProductItem,
      }),
    ),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type RemoveProductItemFromShoppingCart =
  typeof RemoveProductItemFromShoppingCart.Type;

export const ConfirmShoppingCart = Command('ConfirmShoppingCart', {
  data: Schema.toStandardSchemaV1(
    Schema.Struct({
      shoppingCartId: Schema.String,
    }),
  ),
  metadata: ShoppingCartCommandMetadata,
});
export type ConfirmShoppingCart = typeof ConfirmShoppingCart.Type;

export const CancelShoppingCart = Command('CancelShoppingCart', {
  data: Schema.toStandardSchemaV1(
    Schema.Struct({
      shoppingCartId: Schema.String,
    }),
  ),
  metadata: ShoppingCartCommandMetadata,
});
export type CancelShoppingCart = typeof CancelShoppingCart.Type;

export const ShoppingCartCommand = Commands(
  AddProductItemToShoppingCart,
  RemoveProductItemFromShoppingCart,
  ConfirmShoppingCart,
  CancelShoppingCart,
);
export type ShoppingCartCommand = typeof ShoppingCartCommand.Type;
```

## B5. TypeBox through an adapter

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/b5-typebox/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/b5-typebox/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/b5-typebox/usage.ts)

### Events

```ts
import Type, { type Static } from 'typebox';
import { standard } from '../../lib/typebox';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Event, Events } from '../../lib';

// JSON has no Date: ISO 8601 string on the wire, Date in code.
export const isoDate = Type.Codec(Type.String({ format: 'date-time' }))
  .Decode((iso) => new Date(iso))
  .Encode((date) => date.toISOString());

export const ProductItem = Type.Object({
  productId: Type.String(),
  quantity: Type.Number(),
});
export type ProductItem = Static<typeof ProductItem>;

export const PricedProductItem = Type.Object({
  ...ProductItem.properties,
  unitPrice: Type.Number(),
});
export type PricedProductItem = Static<typeof PricedProductItem>;

export const ShoppingCartEventMetadata = standard(
  Type.Object({
    clientId: Type.String(),
  }),
);
export type ShoppingCartEventMetadata = StandardSchemaV1.InferOutput<
  typeof ShoppingCartEventMetadata
>;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: standard(
      Type.Object({
        shoppingCartId: Type.String(),
        clientId: Type.String(),
        productItem: PricedProductItem,
        addedAt: isoDate,
      }),
    ),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemAddedToShoppingCart =
  typeof ProductItemAddedToShoppingCart.Type;

export const ProductItemRemovedFromShoppingCart = Event(
  'ProductItemRemovedFromShoppingCart',
  {
    data: standard(
      Type.Object({
        shoppingCartId: Type.String(),
        productItem: PricedProductItem,
        removedAt: isoDate,
      }),
    ),
    metadata: ShoppingCartEventMetadata,
  },
);
export type ProductItemRemovedFromShoppingCart =
  typeof ProductItemRemovedFromShoppingCart.Type;

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: standard(
    Type.Object({
      shoppingCartId: Type.String(),
      confirmedAt: isoDate,
    }),
  ),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartConfirmed = typeof ShoppingCartConfirmed.Type;

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: standard(
    Type.Object({
      shoppingCartId: Type.String(),
      cancelledAt: isoDate,
    }),
  ),
  metadata: ShoppingCartEventMetadata,
});
export type ShoppingCartCancelled = typeof ShoppingCartCancelled.Type;

export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import Type, { type Static } from 'typebox';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { standard } from '../../lib/typebox';
import { Command, Commands } from '../../lib';
import {
  evolve,
  initialState,
  isoDate,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const ShoppingCartCommandMetadata = standard(
  Type.Object({
    now: isoDate,
    clientId: Type.String(),
  }),
);
export type ShoppingCartCommandMetadata = StandardSchemaV1.InferOutput<
  typeof ShoppingCartCommandMetadata
>;

export const AddProductItemToShoppingCart = Command(
  'AddProductItemToShoppingCart',
  {
    data: standard(
      Type.Object({
        clientId: Type.String(),
        shoppingCartId: Type.String(),
        productItem: PricedProductItem,
      }),
    ),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type AddProductItemToShoppingCart =
  typeof AddProductItemToShoppingCart.Type;

export const RemoveProductItemFromShoppingCart = Command(
  'RemoveProductItemFromShoppingCart',
  {
    data: standard(
      Type.Object({
        shoppingCartId: Type.String(),
        productItem: PricedProductItem,
      }),
    ),
    metadata: ShoppingCartCommandMetadata,
  },
);
export type RemoveProductItemFromShoppingCart =
  typeof RemoveProductItemFromShoppingCart.Type;

export const ConfirmShoppingCart = Command('ConfirmShoppingCart', {
  data: standard(
    Type.Object({
      shoppingCartId: Type.String(),
    }),
  ),
  metadata: ShoppingCartCommandMetadata,
});
export type ConfirmShoppingCart = typeof ConfirmShoppingCart.Type;

export const CancelShoppingCart = Command('CancelShoppingCart', {
  data: standard(
    Type.Object({
      shoppingCartId: Type.String(),
    }),
  ),
  metadata: ShoppingCartCommandMetadata,
});
export type CancelShoppingCart = typeof CancelShoppingCart.Type;

export const ShoppingCartCommand = Commands(
  AddProductItemToShoppingCart,
  RemoveProductItemFromShoppingCart,
  ConfirmShoppingCart,
  CancelShoppingCart,
);
export type ShoppingCartCommand = typeof ShoppingCartCommand.Type;
```

## C. Type first: hand-written types, schema checked against them

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/c-type-first/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/c-type-first/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/c-type-first/usage.ts)

### Events

```ts
import { Event, Events, s } from '../../lib';

export type ShoppingCartEventMetadata = { clientId: string };
export const ShoppingCartEventMetadata = { clientId: s.string() };

export interface ProductItem {
  productId: string;
  quantity: number;
}
export const ProductItem = s.object({
  productId: s.string(),
  quantity: s.number(),
});

export type PricedProductItem = ProductItem & {
  unitPrice: number;
};
export const PricedProductItem = ProductItem.extend({
  unitPrice: s.number(),
});

export type ProductItemAddedToShoppingCart = Event<
  'ProductItemAddedToShoppingCart',
  {
    shoppingCartId: string;
    clientId: string;
    productItem: PricedProductItem;
    addedAt: Date;
  },
  ShoppingCartEventMetadata
>;
export const ProductItemAddedToShoppingCart =
  Event<ProductItemAddedToShoppingCart>('ProductItemAddedToShoppingCart', {
    data: {
      shoppingCartId: s.string(),
      clientId: s.string(),
      productItem: PricedProductItem,
      addedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  });

export type ProductItemRemovedFromShoppingCart = Event<
  'ProductItemRemovedFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
    removedAt: Date;
  },
  ShoppingCartEventMetadata
>;
export const ProductItemRemovedFromShoppingCart =
  Event<ProductItemRemovedFromShoppingCart>(
    'ProductItemRemovedFromShoppingCart',
    {
      data: {
        shoppingCartId: s.string(),
        productItem: PricedProductItem,
        removedAt: s.date(),
      },
      metadata: ShoppingCartEventMetadata,
    },
  );

export type ShoppingCartConfirmed = Event<
  'ShoppingCartConfirmed',
  {
    shoppingCartId: string;
    confirmedAt: Date;
  },
  ShoppingCartEventMetadata
>;
export const ShoppingCartConfirmed = Event<ShoppingCartConfirmed>(
  'ShoppingCartConfirmed',
  {
    data: { shoppingCartId: s.string(), confirmedAt: s.date() },
    metadata: ShoppingCartEventMetadata,
  },
);

export type ShoppingCartCancelled = Event<
  'ShoppingCartCancelled',
  {
    shoppingCartId: string;
    cancelledAt: Date;
  },
  ShoppingCartEventMetadata
>;
export const ShoppingCartCancelled = Event<ShoppingCartCancelled>(
  'ShoppingCartCancelled',
  {
    data: { shoppingCartId: s.string(), cancelledAt: s.date() },
    metadata: ShoppingCartEventMetadata,
  },
);

export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;
export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
  type DefaultCommandMetadata,
} from '@event-driven-io/emmett';
import { Command, Commands, s } from '../../lib';
import {
  evolve,
  initialState,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export type ShoppingCartCommandMetadata = DefaultCommandMetadata & {
  clientId: string;
};
export const ShoppingCartCommandMetadata = {
  now: s.date(),
  clientId: s.string(),
};

export type AddProductItemToShoppingCart = Command<
  'AddProductItemToShoppingCart',
  {
    clientId: string;
    shoppingCartId: string;
    productItem: PricedProductItem;
  },
  ShoppingCartCommandMetadata
>;
export const AddProductItemToShoppingCart =
  Command<AddProductItemToShoppingCart>('AddProductItemToShoppingCart', {
    data: {
      clientId: s.string(),
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    metadata: ShoppingCartCommandMetadata,
  });

export type RemoveProductItemFromShoppingCart = Command<
  'RemoveProductItemFromShoppingCart',
  {
    shoppingCartId: string;
    productItem: PricedProductItem;
  },
  ShoppingCartCommandMetadata
>;
export const RemoveProductItemFromShoppingCart =
  Command<RemoveProductItemFromShoppingCart>(
    'RemoveProductItemFromShoppingCart',
    {
      data: { shoppingCartId: s.string(), productItem: PricedProductItem },
      metadata: ShoppingCartCommandMetadata,
    },
  );

export type ConfirmShoppingCart = Command<
  'ConfirmShoppingCart',
  {
    shoppingCartId: string;
  },
  ShoppingCartCommandMetadata
>;
export const ConfirmShoppingCart = Command<ConfirmShoppingCart>(
  'ConfirmShoppingCart',
  {
    data: { shoppingCartId: s.string() },
    metadata: ShoppingCartCommandMetadata,
  },
);

export type CancelShoppingCart = Command<
  'CancelShoppingCart',
  {
    shoppingCartId: string;
  },
  ShoppingCartCommandMetadata
>;
export const CancelShoppingCart = Command<CancelShoppingCart>(
  'CancelShoppingCart',
  {
    data: { shoppingCartId: s.string() },
    metadata: ShoppingCartCommandMetadata,
  },
);

export type ShoppingCartCommand =
  | AddProductItemToShoppingCart
  | RemoveProductItemFromShoppingCart
  | ConfirmShoppingCart
  | CancelShoppingCart;
export const ShoppingCartCommand = Commands(
  AddProductItemToShoppingCart,
  RemoveProductItemFromShoppingCart,
  ConfirmShoppingCart,
  CancelShoppingCart,
);
```

## D. Grouped: one definition per union

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/d-grouped/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/d-grouped/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/d-grouped/usage.ts)

### Events

```ts
import { Events, s } from '../../lib';

export const ProductItem = s.object({
  productId: s.string(),
  quantity: s.number(),
});
export type ProductItem = typeof ProductItem.Type;

export const PricedProductItem = ProductItem.extend({
  unitPrice: s.number(),
});
export type PricedProductItem = typeof PricedProductItem.Type;

export const ShoppingCartEvent = Events(
  {
    ProductItemAddedToShoppingCart: {
      shoppingCartId: s.string(),
      clientId: s.string(),
      productItem: PricedProductItem,
      addedAt: s.date(),
    },
    ProductItemRemovedFromShoppingCart: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
      removedAt: s.date(),
    },
    ShoppingCartConfirmed: {
      shoppingCartId: s.string(),
      confirmedAt: s.date(),
    },
    ShoppingCartCancelled: {
      shoppingCartId: s.string(),
      cancelledAt: s.date(),
    },
  },
  { metadata: { clientId: s.string() } },
);
export type ShoppingCartEvent = typeof ShoppingCartEvent.Type;
export type ShoppingCartEvents = typeof ShoppingCartEvent.Types;

export const {
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
} = ShoppingCartEvent;
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { Commands, s } from '../../lib';
import {
  evolve,
  initialState,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
  type ShoppingCartEvents,
} from './shoppingCart';

export const ShoppingCartCommand = Commands(
  {
    AddProductItemToShoppingCart: {
      clientId: s.string(),
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    RemoveProductItemFromShoppingCart: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    ConfirmShoppingCart: {
      shoppingCartId: s.string(),
    },
    CancelShoppingCart: {
      shoppingCartId: s.string(),
    },
  },
  { metadata: { now: s.date(), clientId: s.string() } },
);
export type ShoppingCartCommand = typeof ShoppingCartCommand.Type;
export type ShoppingCartCommands = typeof ShoppingCartCommand.Types;
```

### Business logic

```ts
export const addProductItem = (
  command: ShoppingCartCommands['AddProductItemToShoppingCart'],
  state: ShoppingCart,
): ShoppingCartEvents['ProductItemAddedToShoppingCart'] => {
  if (state.status === 'Closed')
    throw new IllegalStateError('Shopping Cart already closed');

  const {
    data: { shoppingCartId, clientId, productItem },
    metadata,
  } = command;

  return ProductItemAddedToShoppingCart(
    { shoppingCartId, clientId, productItem, addedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const removeProductItem = (
  command: ShoppingCartCommands['RemoveProductItemFromShoppingCart'],
  state: ShoppingCart,
): ShoppingCartEvents['ProductItemRemovedFromShoppingCart'] => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId, productItem },
    metadata,
  } = command;

  const currentQuantity = state.productItems.get(productItem.productId) ?? 0;

  if (currentQuantity < productItem.quantity)
    throw new IllegalStateError('Not enough products');

  return ProductItemRemovedFromShoppingCart(
    { shoppingCartId, productItem, removedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const confirm = (
  command: ShoppingCartCommands['ConfirmShoppingCart'],
  state: ShoppingCart,
): ShoppingCartEvents['ShoppingCartConfirmed'] => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const totalQuantityOfAllProductItems = sum(state.productItems.values());

  if (totalQuantityOfAllProductItems <= 0)
    throw new IllegalStateError('Shopping Cart is empty');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return ShoppingCartConfirmed(
    { shoppingCartId, confirmedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const cancel = (
  command: ShoppingCartCommands['CancelShoppingCart'],
  state: ShoppingCart,
): ShoppingCartEvents['ShoppingCartCancelled'] => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return ShoppingCartCancelled(
    { shoppingCartId, cancelledAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const decide = (command: ShoppingCartCommand, state: ShoppingCart) => {
  const { type } = command;

  switch (type) {
    case 'AddProductItemToShoppingCart':
      return addProductItem(command, state);
    case 'RemoveProductItemFromShoppingCart':
      return removeProductItem(command, state);
    case 'ConfirmShoppingCart':
      return confirm(command, state);
    case 'CancelShoppingCart':
      return cancel(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
};

export const decider: Decider<
  ShoppingCart,
  ShoppingCartCommand,
  ShoppingCartEvent
> = {
  decide,
  evolve,
  initialState,
};
```

## E. Interface: `interface X extends Event.Of<typeof X> {}`

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/e-interface/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/e-interface/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/e-interface/usage.ts)

### Events

```ts
import { Event, Events, s } from '../../lib';

export const ProductItem = s.object({
  productId: s.string(),
  quantity: s.number(),
});
export type ProductItem = typeof ProductItem.Type;

export const PricedProductItem = ProductItem.extend({
  unitPrice: s.number(),
});
export type PricedProductItem = typeof PricedProductItem.Type;

export const ShoppingCartEventMetadata = s.object({ clientId: s.string() });
export type ShoppingCartEventMetadata = typeof ShoppingCartEventMetadata.Type;

export const ProductItemAddedToShoppingCart = Event(
  'ProductItemAddedToShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      clientId: s.string(),
      productItem: PricedProductItem,
      addedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  },
);
export interface ProductItemAddedToShoppingCart extends Event.Of<
  typeof ProductItemAddedToShoppingCart
> {}

export const ProductItemRemovedFromShoppingCart = Event(
  'ProductItemRemovedFromShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
      removedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  },
);
export interface ProductItemRemovedFromShoppingCart extends Event.Of<
  typeof ProductItemRemovedFromShoppingCart
> {}

export const ShoppingCartConfirmed = Event('ShoppingCartConfirmed', {
  data: {
    shoppingCartId: s.string(),
    confirmedAt: s.date(),
  },
  metadata: ShoppingCartEventMetadata,
});
export interface ShoppingCartConfirmed extends Event.Of<
  typeof ShoppingCartConfirmed
> {}

export const ShoppingCartCancelled = Event('ShoppingCartCancelled', {
  data: {
    shoppingCartId: s.string(),
    cancelledAt: s.date(),
  },
  metadata: ShoppingCartEventMetadata,
});
export interface ShoppingCartCancelled extends Event.Of<
  typeof ShoppingCartCancelled
> {}

export const ShoppingCartEvent = Events(
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartConfirmed,
  ShoppingCartCancelled,
);
export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { Command, Commands, s } from '../../lib';
import {
  evolve,
  initialState,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const ShoppingCartCommandMetadata = s.object({
  now: s.date(),
  clientId: s.string(),
});
export type ShoppingCartCommandMetadata =
  typeof ShoppingCartCommandMetadata.Type;

export const AddProductItemToShoppingCart = Command(
  'AddProductItemToShoppingCart',
  {
    data: {
      clientId: s.string(),
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    metadata: ShoppingCartCommandMetadata,
  },
);
export interface AddProductItemToShoppingCart extends Command.Of<
  typeof AddProductItemToShoppingCart
> {}

export const RemoveProductItemFromShoppingCart = Command(
  'RemoveProductItemFromShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    metadata: ShoppingCartCommandMetadata,
  },
);
export interface RemoveProductItemFromShoppingCart extends Command.Of<
  typeof RemoveProductItemFromShoppingCart
> {}

export const ConfirmShoppingCart = Command('ConfirmShoppingCart', {
  data: {
    shoppingCartId: s.string(),
  },
  metadata: ShoppingCartCommandMetadata,
});
export interface ConfirmShoppingCart extends Command.Of<
  typeof ConfirmShoppingCart
> {}

export const CancelShoppingCart = Command('CancelShoppingCart', {
  data: {
    shoppingCartId: s.string(),
  },
  metadata: ShoppingCartCommandMetadata,
});
export interface CancelShoppingCart extends Command.Of<
  typeof CancelShoppingCart
> {}

export const ShoppingCartCommand = Commands(
  AddProductItemToShoppingCart,
  RemoveProductItemFromShoppingCart,
  ConfirmShoppingCart,
  CancelShoppingCart,
);
export type ShoppingCartCommand =
  | AddProductItemToShoppingCart
  | RemoveProductItemFromShoppingCart
  | ConfirmShoppingCart
  | CancelShoppingCart;
```

## F. Classes

Files: [shoppingCart.ts](../prototypes/api-ergonomics/styles/f-class/shoppingCart.ts), [businessLogic.ts](../prototypes/api-ergonomics/styles/f-class/businessLogic.ts), [usage.ts](../prototypes/api-ergonomics/styles/f-class/usage.ts)

### Events

```ts
import { EventClass, s } from '../../lib';

export const ProductItem = s.object({
  productId: s.string(),
  quantity: s.number(),
});
export type ProductItem = typeof ProductItem.Type;

export const PricedProductItem = ProductItem.extend({
  unitPrice: s.number(),
});
export type PricedProductItem = typeof PricedProductItem.Type;

export const ShoppingCartEventMetadata = s.object({ clientId: s.string() });
export type ShoppingCartEventMetadata = typeof ShoppingCartEventMetadata.Type;

export class ProductItemAddedToShoppingCart extends EventClass(
  'ProductItemAddedToShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      clientId: s.string(),
      productItem: PricedProductItem,
      addedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  },
) {}

export class ProductItemRemovedFromShoppingCart extends EventClass(
  'ProductItemRemovedFromShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
      removedAt: s.date(),
    },
    metadata: ShoppingCartEventMetadata,
  },
) {}

export class ShoppingCartConfirmed extends EventClass('ShoppingCartConfirmed', {
  data: {
    shoppingCartId: s.string(),
    confirmedAt: s.date(),
  },
  metadata: ShoppingCartEventMetadata,
}) {}

export class ShoppingCartCancelled extends EventClass('ShoppingCartCancelled', {
  data: {
    shoppingCartId: s.string(),
    cancelledAt: s.date(),
  },
  metadata: ShoppingCartEventMetadata,
}) {}

export type ShoppingCartEvent =
  | ProductItemAddedToShoppingCart
  | ProductItemRemovedFromShoppingCart
  | ShoppingCartConfirmed
  | ShoppingCartCancelled;

export const shoppingCartEventTypes = [
  ProductItemAddedToShoppingCart.type,
  ProductItemRemovedFromShoppingCart.type,
  ShoppingCartConfirmed.type,
  ShoppingCartCancelled.type,
];
```

### Commands

```ts
import {
  EmmettError,
  IllegalStateError,
  sum,
  type Decider,
} from '@event-driven-io/emmett';
import { CommandClass, s } from '../../lib';
import {
  evolve,
  initialState,
  PricedProductItem,
  ProductItemAddedToShoppingCart,
  ProductItemRemovedFromShoppingCart,
  ShoppingCartCancelled,
  ShoppingCartConfirmed,
  type ShoppingCart,
  type ShoppingCartEvent,
} from './shoppingCart';

export const ShoppingCartCommandMetadata = s.object({
  now: s.date(),
  clientId: s.string(),
});
export type ShoppingCartCommandMetadata =
  typeof ShoppingCartCommandMetadata.Type;

export class AddProductItemToShoppingCart extends CommandClass(
  'AddProductItemToShoppingCart',
  {
    data: {
      clientId: s.string(),
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    metadata: ShoppingCartCommandMetadata,
  },
) {}

export class RemoveProductItemFromShoppingCart extends CommandClass(
  'RemoveProductItemFromShoppingCart',
  {
    data: {
      shoppingCartId: s.string(),
      productItem: PricedProductItem,
    },
    metadata: ShoppingCartCommandMetadata,
  },
) {}

export class ConfirmShoppingCart extends CommandClass('ConfirmShoppingCart', {
  data: {
    shoppingCartId: s.string(),
  },
  metadata: ShoppingCartCommandMetadata,
}) {}

export class CancelShoppingCart extends CommandClass('CancelShoppingCart', {
  data: {
    shoppingCartId: s.string(),
  },
  metadata: ShoppingCartCommandMetadata,
}) {}

export type ShoppingCartCommand =
  | AddProductItemToShoppingCart
  | RemoveProductItemFromShoppingCart
  | ConfirmShoppingCart
  | CancelShoppingCart;
```

### Business logic

```ts
export const addProductItem = (
  command: AddProductItemToShoppingCart,
  state: ShoppingCart,
): ProductItemAddedToShoppingCart => {
  if (state.status === 'Closed')
    throw new IllegalStateError('Shopping Cart already closed');

  const {
    data: { shoppingCartId, clientId, productItem },
    metadata,
  } = command;

  return new ProductItemAddedToShoppingCart(
    { shoppingCartId, clientId, productItem, addedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const removeProductItem = (
  command: RemoveProductItemFromShoppingCart,
  state: ShoppingCart,
): ProductItemRemovedFromShoppingCart => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId, productItem },
    metadata,
  } = command;

  const currentQuantity = state.productItems.get(productItem.productId) ?? 0;

  if (currentQuantity < productItem.quantity)
    throw new IllegalStateError('Not enough products');

  return new ProductItemRemovedFromShoppingCart(
    { shoppingCartId, productItem, removedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const confirm = (
  command: ConfirmShoppingCart,
  state: ShoppingCart,
): ShoppingCartConfirmed => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const totalQuantityOfAllProductItems = sum(state.productItems.values());

  if (totalQuantityOfAllProductItems <= 0)
    throw new IllegalStateError('Shopping Cart is empty');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return new ShoppingCartConfirmed(
    { shoppingCartId, confirmedAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const cancel = (
  command: CancelShoppingCart,
  state: ShoppingCart,
): ShoppingCartCancelled => {
  if (state.status !== 'Opened')
    throw new IllegalStateError('Shopping Cart is not opened');

  const {
    data: { shoppingCartId },
    metadata,
  } = command;

  return new ShoppingCartCancelled(
    { shoppingCartId, cancelledAt: metadata.now },
    { clientId: metadata.clientId },
  );
};

export const decide = (command: ShoppingCartCommand, state: ShoppingCart) => {
  const { type } = command;

  switch (type) {
    case 'AddProductItemToShoppingCart':
      return addProductItem(command, state);
    case 'RemoveProductItemFromShoppingCart':
      return removeProductItem(command, state);
    case 'ConfirmShoppingCart':
      return confirm(command, state);
    case 'CancelShoppingCart':
      return cancel(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command type`);
    }
  }
};

export const decider: Decider<
  ShoppingCart,
  ShoppingCartCommand,
  ShoppingCartEvent
> = {
  decide,
  evolve,
  initialState,
};
```

