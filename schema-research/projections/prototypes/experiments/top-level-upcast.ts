// Does a single upcast narrow by a top-level schemaVersion, with no wrapper around the message?
type Message<T extends string, V extends number, D> = { type: T; schemaVersion: V; data: D; metadata: { clientId: string } };

type ConfirmedV1 = Message<'ShoppingCartConfirmed', 1, { clientId: string; total: number }>;
type ConfirmedV2 = Message<'ShoppingCartConfirmed', 2, { clientId: string; totalAmount: number }>;

export const upcast = (event: ConfirmedV1 | ConfirmedV2): ConfirmedV2 => {
  switch (event.schemaVersion) {
    case 1:
      return { type: event.type, schemaVersion: 2, data: { clientId: event.data.clientId, totalAmount: event.data.total }, metadata: event.metadata };
    case 2:
      return event;
  }
};

const v1: ConfirmedV1 = { type: 'ShoppingCartConfirmed', schemaVersion: 1, data: { clientId: 'c1', total: 10 }, metadata: { clientId: 'client-1' } };
console.log(JSON.stringify(upcast(v1)));
