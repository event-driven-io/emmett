/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  CommandHandler,
  EmmettError,
  type Command,
  type Event,
} from '@event-driven-io/emmett';

// #region state-definition
type ShoppingCart = {
  items: Set<string>;
};
// #endregion state-definition

// #region initial-state
export function initialState(): ShoppingCart {
  return {
    items: new Set(),
  };
}
// #endregion initial-state

// #region commands
// Command<type, payload>
export type AddItem = Command<
  // Type
  'AddItem',
  // Payload
  {
    name: string;
  }
>;

// Command<type, payload>
export type RemoveItem = Command<
  // Type
  'RemoveItem',
  // Payload
  {
    name: string;
  }
>;

// Union type of all possible commands (for later)
export type ShoppingCartCommand = AddItem | RemoveItem;

// #endregion commands

// #region events

// Event<type, payload>
export type ItemAdded = Event<
  'ItemAdded',
  {
    name: string;
  }
>;

export type ItemRemoved = Event<
  'ItemRemoved',
  {
    name: string;
  }
>;

// Union type of all possible shopping cart events (for later)
export type ShoppingCartEvent = ItemAdded | ItemRemoved;
// #endregion events

// #region command-handler-functions
export function addItem(
  command: AddItem,
  state: ShoppingCart,
): ShoppingCartEvent {
  return {
    type: 'ItemAdded',
    data: {
      name: command.data.name,
    },
  };
}

export function removeItem(
  command: RemoveItem,
  state: ShoppingCart,
): ItemRemoved {
  return {
    type: 'ItemRemoved',
    data: {
      name: command.data.name,
    },
  };
}
// #endregion command-handler-functions

// #region decider
export function decide(
  command: ShoppingCartCommand,
  state: ShoppingCart,
): ShoppingCartEvent {
  const { type } = command;
  switch (type) {
    case 'AddItem':
      return addItem(command, state);
    case 'RemoveItem':
      return removeItem(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command`);
    }
  }
}
// #endregion decider

// #region evolve
export function evolve(
  state: ShoppingCart,
  event: ShoppingCartEvent,
): ShoppingCart {
  const { type, data } = event;
  switch (type) {
    case 'ItemAdded': {
      const nextState = {
        ...state,
        items: new Set([...state.items, data.name]),
      };
      // Print the event data and the contents of the changed shopping cart
      console.log(
        `${type}(name: ${data.name}) // ShoppingCart(items: ${Array.from(nextState.items.values()).join(', ')})`,
      );
      return nextState;
    }
    case 'ItemRemoved': {
      const items = new Set(state.items);
      items.delete(data.name);
      const nextState = {
        ...state,
        items,
      };
      // Print the event data and the contents of the changed shopping cart
      console.log(
        `${type}(name: ${data.name}) // ShoppingCart(items: ${Array.from(nextState.items.values()).join(', ')})`,
      );
      return nextState;
    }
    default: {
      const _notExistingEventType: never = type;
      throw new EmmettError(`Unknown event`);
    }
  }
}
//#endregion evolve

//#region handle
export const handle = CommandHandler({ evolve, initialState });
//#endregion handle

//#region event-store
import { getInMemoryEventStore } from '@event-driven-io/emmett';

const eventStore = getInMemoryEventStore();
//#endregion event-store

//#region example-commands
const addPizza: AddItem = {
  type: 'AddItem',
  data: {
    name: 'Pizza',
  },
};

const addIceCream: AddItem = {
  type: 'AddItem',
  data: {
    name: 'Ice Cream',
  },
};

const removePizza: RemoveItem = {
  type: 'RemoveItem',
  data: {
    name: 'Pizza',
  },
};

const removeIceCream: RemoveItem = {
  type: 'RemoveItem',
  data: {
    name: 'Ice Cream',
  },
};

//#endregion example-commands

//#region handle-example-commands
// Use a constant cart id for this example. In real life applications, this should be a real cart id.
const shoppingCartId = '1';

// 2. Handle command
await handle(eventStore, shoppingCartId, (state) => decide(addPizza, state));
console.log('---');
await handle(eventStore, shoppingCartId, (state) => decide(addIceCream, state));
console.log('---');
await handle(eventStore, shoppingCartId, (state) =>
  decide(removeIceCream, state),
);
//#endregion handle-example-commands
