import { describe, expectTypeOf, it } from 'vitest';
import type {
  AnyCommand,
  AnyEvent,
  AnyMessage,
  Command,
  CreateCommandType,
  CreateEventType,
  Event,
  Message,
  MessageSchemaVersionOf,
} from '.';

type ProductItem = { productId: string; quantity: number };
type D1 = { productId: string };
type D2 = { productItem: ProductItem };

type V1 = Event<'ProductItemAdded', D1>;
type V2 = Event<'ProductItemAdded', D2, undefined, 2>;

type C1 = Command<'AddProductItem', D1>;
type C3 = Command<'AddProductItem', D2, undefined, 3>;

void describe('Message schema version', () => {
  void it('narrows event data by the declared schema version', () => {
    const narrow = (e: V1 | V2) => {
      switch (e.schemaVersion) {
        case 2:
          expectTypeOf(e.data).toEqualTypeOf<D2>();
          return;
        default:
          expectTypeOf(e.data).toEqualTypeOf<D1>();
          return;
      }
    };

    expectTypeOf(narrow).toBeFunction();
  });

  void it('narrows unversioned events by an explicit version 1 or a missing version', () => {
    const narrow = (e: V1 | V2) => {
      switch (e.schemaVersion) {
        case undefined:
        case 1:
          expectTypeOf(e.data).toEqualTypeOf<D1>();
          return;
        case 2:
          expectTypeOf(e.data).toEqualTypeOf<D2>();
          return;
      }
    };

    expectTypeOf(narrow).toBeFunction();
  });

  void it('accepts an unversioned event with or without schema version 1', () => {
    expectTypeOf<{ type: 'ProductItemAdded'; data: D1 }>().toExtend<V1>();
    expectTypeOf<{
      type: 'ProductItemAdded';
      data: D1;
      schemaVersion: 1;
    }>().toExtend<V1>();
    expectTypeOf<
      Event<'ProductItemAdded', D1, undefined, 1>
    >().toEqualTypeOf<V1>();
  });

  void it('requires the schema version for a declared version other than 1', () => {
    expectTypeOf<{ type: 'ProductItemAdded'; data: D2 }>().not.toExtend<V2>();
    expectTypeOf<{
      type: 'ProductItemAdded';
      data: D2;
      schemaVersion: 2;
    }>().toExtend<V2>();
    expectTypeOf<{ type: 'AddProductItem'; data: D2 }>().not.toExtend<C3>();
  });

  void it('narrows command data by the declared schema version', () => {
    expectTypeOf<{ type: 'AddProductItem'; data: D1 }>().toExtend<C1>();

    const narrow = (c: C1 | C3) => {
      switch (c.schemaVersion) {
        case 3:
          expectTypeOf(c.data).toEqualTypeOf<Readonly<D2>>();
          return;
        default:
          expectTypeOf(c.data).toEqualTypeOf<Readonly<D1>>();
          return;
      }
    };

    expectTypeOf(narrow).toBeFunction();
  });

  void it('narrows a union of versioned events and commands', () => {
    const narrow = (m: V1 | V2 | C1 | C3) => {
      switch (m.schemaVersion) {
        case 2:
          expectTypeOf(m).toEqualTypeOf<V2>();
          return;
        case 3:
          expectTypeOf(m).toEqualTypeOf<C3>();
          return;
        default:
          expectTypeOf(m).toEqualTypeOf<V1 | C1>();
          return;
      }
    };

    expectTypeOf(narrow).toBeFunction();
  });

  void it('narrows messages by the declared schema version', () => {
    type M1 = Message<'ProductItemAdded', D1>;
    type M2 = Message<'ProductItemAdded', D2, undefined, 2>;

    const narrow = (m: M1 | M2) => {
      switch (m.schemaVersion) {
        case 2:
          expectTypeOf(m.data).toEqualTypeOf<D2 | Readonly<D2>>();
          return;
        default:
          expectTypeOf(m.data).toEqualTypeOf<D1 | Readonly<D1>>();
          return;
      }
    };

    expectTypeOf(narrow).toBeFunction();
  });

  void it('narrows created event and command types mixed with versioned types', () => {
    type CreatedV1 = CreateEventType<'ProductItemAdded', D1>;
    type CreatedC1 = CreateCommandType<'AddProductItem', D1>;
    type CreatedV2 = CreateEventType<'ProductItemAdded', D2, undefined, 2>;

    expectTypeOf<{
      type: 'ProductItemAdded';
      data: D2;
    }>().not.toExtend<CreatedV2>();

    const narrow = (m: CreatedV1 | V2 | CreatedC1 | C3) => {
      switch (m.schemaVersion) {
        case 2:
          expectTypeOf(m).toEqualTypeOf<V2>();
          return;
        case 3:
          expectTypeOf(m).toEqualTypeOf<C3>();
          return;
        default:
          expectTypeOf(m).toEqualTypeOf<CreatedV1 | CreatedC1>();
          return;
      }
    };

    expectTypeOf(narrow).toBeFunction();
  });

  void it('fits versioned types into generic message constraints', () => {
    expectTypeOf<V1>().toExtend<Event>();
    expectTypeOf<V2>().toExtend<Event>();
    expectTypeOf<V1 | V2>().toExtend<Event>();
    expectTypeOf<V1 | V2>().toExtend<AnyEvent>();
    expectTypeOf<C1>().toExtend<Command>();
    expectTypeOf<C3>().toExtend<Command>();
    expectTypeOf<C1 | C3>().toExtend<Command>();
    expectTypeOf<C1 | C3>().toExtend<AnyCommand>();
    expectTypeOf<V1 | V2 | C1 | C3>().toExtend<Message>();
    expectTypeOf<V1 | V2 | C1 | C3>().toExtend<AnyMessage>();

    const acceptEvent = <T extends Event>(e: T): T => e;
    const acceptCommand = <T extends Command>(c: T): T => c;
    const acceptMessage = <T extends Message>(m: T): T => m;

    expectTypeOf(acceptEvent<V1 | V2>).returns.toEqualTypeOf<V1 | V2>();
    expectTypeOf(acceptCommand<C1 | C3>).returns.toEqualTypeOf<C1 | C3>();
    expectTypeOf(acceptMessage<V1 | V2 | C1 | C3>).returns.toEqualTypeOf<
      V1 | V2 | C1 | C3
    >();
  });

  void it('reads the schema version of a generic event as a number', () => {
    const readVersion = <T extends Event>(e: T) => e.schemaVersion;

    expectTypeOf(readVersion).returns.toEqualTypeOf<number | undefined>();
    expectTypeOf<Event['schemaVersion']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Event<string, D1>['schemaVersion']>().toEqualTypeOf<
      number | undefined
    >();
  });

  void it('exposes the declared schema version literal', () => {
    expectTypeOf<MessageSchemaVersionOf<V1>>().toEqualTypeOf<1>();
    expectTypeOf<MessageSchemaVersionOf<V2>>().toEqualTypeOf<2>();
    expectTypeOf<MessageSchemaVersionOf<C3>>().toEqualTypeOf<3>();
    expectTypeOf<MessageSchemaVersionOf<Event>>().toEqualTypeOf<number>();
    expectTypeOf<MessageSchemaVersionOf<Message>>().toEqualTypeOf<number>();
  });
});
