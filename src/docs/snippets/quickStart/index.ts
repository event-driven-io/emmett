import {
  CommandHandler,
  EmmettError,
  type Command,
  type Event,
} from "@event-driven-io/emmett";


type ShoppingCart ={
  items: Set<string>
};

export function initialState(): ShoppingCart {
  return {
    items: new Set(),
  }
}

// Command<type, payload>
export type AddItem = Command<
  // Type
  "AddItem",
  // Payload
  {
    name: string;
  }
>;

// Command<type, payload>
export type RemoveItem = Command<
  // Type
  "RemoveItem",
  // Payload
  {
    name: string;
  }
>;

// Union type of all possible commands (for later)
export type ShoppingCartCommand = AddItem | RemoveItem;

// Event<type, payload>
export type ItemAdded = Event<
  "ItemAdded",
  {
    name: string;
  }
>;

export type ItemRemoved = Event<
  "ItemRemoved",
  {
    name: string;
  }
>;

// Union type of all possible shopping cart events (for later)
export type ShoppingCartEvent = ItemAdded | ItemRemoved;

export function addItem(
  command: AddItem,
  state: ShoppingCart
): ShoppingCartEvent {
  return {
    type: "ItemAdded",
    data: {
      name: command.data.name
    },
  };
}

export function removeItem(
  command: RemoveItem,
  state: ShoppingCart
): ItemRemoved {
  return {
    type: "ItemRemoved",
    data: {
      name: command.data.name
    },
  };
}

export function decide(command: ShoppingCartCommand, state: ShoppingCart): ShoppingCartEvent {
  const { type } = command;
  switch (type) {
    case "AddItem":
      return addItem(command, state);
    case "RemoveItem":
      return removeItem(command, state);
    default: {
      const _notExistingCommandType: never = type;
      throw new EmmettError(`Unknown command ${_notExistingCommandType}`);
    }
  }
}

export function evolve(state: ShoppingCart, event: ShoppingCartEvent): ShoppingCart {
  const { type, data } = event;
  switch (type) {
    case "ItemAdded": {
      const nextState = {
        ...state,
        items: new Set([...state.items, data.name])
      };
      console.log(`${type}(name: ${data.name}) // ShoppingCart(items: ${Array.from(nextState.items.values()).join(", ")})`);
      return nextState;
    }
    case "ItemRemoved": {
      const items = new Set(state.items);
      items.delete(data.name);
      const nextState = {
        ...state,
        items
      }
      console.log(`${type}(name: ${data.name}) // ShoppingCart(items: ${Array.from(nextState.items.values()).join(", ")})`);
      return nextState;
    }
    default: {
      const _notExistingEventType: never = type;
      throw new EmmettError(`Unknown event ${_notExistingEventType}`);
    }
  }
}

export const handle = CommandHandler({ evolve, initialState });

import { getInMemoryEventStore } from "@event-driven-io/emmett";

const eventStore = getInMemoryEventStore();

const addPizza: AddItem = {
  type: "AddItem",
  data: {
    name: "Pizza"
  },
};

const addIceCream: AddItem = {
  type: "AddItem",
  data: {
    name: "Ice Cream"
  },
};

const removePizza: RemoveItem = {
  type: "RemoveItem",
  data: {
    name: "Pizza"
  },
};

const removeIceCream: RemoveItem = {
  type: "RemoveItem",
  data: {
    name: "Ice Cream"
  },
};


const counterId = "1";

// 2. Handle command
await handle(eventStore, counterId, (state) => decide(addPizza, state));
console.log("---")
await handle(eventStore, counterId, (state) => decide(addIceCream, state));
console.log("---")
await handle(eventStore, counterId, (state) => decide(removeIceCream, state));
