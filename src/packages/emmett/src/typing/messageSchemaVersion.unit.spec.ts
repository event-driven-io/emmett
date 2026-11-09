import { describe, expectTypeOf, it } from 'vitest';
import { assertDeepEqual } from '../testing';
import {
  command,
  event,
  message,
  type AnyCommand,
  type AnyEvent,
  type AnyMessage,
  type Command,
  type CreateCommandType,
  type CreateEventType,
  type Event,
  type Message,
  type MessageSchemaVersionOf,
} from '.';

type ProductItem = { productId: string; quantity: number };
type D1 = { productId: string };
type D2 = { productItem: ProductItem };

type V1 = Event<'ProductItemAdded', D1>;
type V2 = Event<'ProductItemAdded', D2, undefined, 2>;

type C1 = Command<'AddProductItem', D1>;
type C3 = Command<'AddProductItem', D2, undefined, 3>;

type Meta = { tenantId: string };
type V1m = Event<'ProductItemAdded', D1, Meta>;
type V1x = Event<'ProductItemAdded', D1, undefined, 1>;
type V2m = Event<'ProductItemAdded', D2, Meta, 2>;
type C2 = Command<'AddProductItem', D2, undefined, 2>;
type C2m = Command<'AddProductItem', D2, Meta, 2>;

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

void describe('Message factories with schema version', () => {
  const d1: D1 = { productId: 'product-123' };
  const d2: D2 = { productItem: { productId: 'product-123', quantity: 2 } };
  const metadata: Meta = { tenantId: 'tenant-a' };
  const now = new Date();

  void it('creates an event with the given schema version', () => {
    const result = event<V2>('ProductItemAdded', d2, 2);

    expectTypeOf(result).toEqualTypeOf<V2>();
    assertDeepEqual(result, {
      type: 'ProductItemAdded',
      data: d2,
      kind: 'Event',
      schemaVersion: 2,
    });
  });

  void it('creates an event with metadata and the given schema version', () => {
    const result = event<V2m>('ProductItemAdded', d2, metadata, 2);

    expectTypeOf(result).toEqualTypeOf<V2m>();
    assertDeepEqual(result, {
      type: 'ProductItemAdded',
      data: d2,
      metadata,
      kind: 'Event',
      schemaVersion: 2,
    });
  });

  void it('creates an unversioned event without schema version', () => {
    const result = event<V1>('ProductItemAdded', d1);
    const withMetadata = event<V1m>('ProductItemAdded', d1, metadata);

    expectTypeOf(result).toEqualTypeOf<V1>();
    assertDeepEqual(result, {
      type: 'ProductItemAdded',
      data: d1,
      kind: 'Event',
    });
    assertDeepEqual(withMetadata, {
      type: 'ProductItemAdded',
      data: d1,
      metadata,
      kind: 'Event',
    });
  });

  void it('rejects event calls that do not match the declared schema version', () => {
    // @ts-expect-error the version is required for a declared version 2
    event<V2>('ProductItemAdded', d2);
    // @ts-expect-error the version must match the declared one
    event<V2>('ProductItemAdded', d2, 3);
    // @ts-expect-error declared metadata cannot be left out
    event<V2m>('ProductItemAdded', d2, 2);
    // @ts-expect-error the version is required with declared metadata
    event<V2m>('ProductItemAdded', d2, metadata);
    // @ts-expect-error an unversioned event takes no version
    event<V1>('ProductItemAdded', d1, 1);
    // @ts-expect-error an explicit version 1 takes no version
    event<V1x>('ProductItemAdded', d1, 1);
    // @ts-expect-error an event without declared metadata has no metadata position
    event<V2>('ProductItemAdded', d2, undefined, 2);
  });

  void it('creates a command with the given schema version', () => {
    const result = command<C2>('AddProductItem', d2, 2);

    expectTypeOf(result).toEqualTypeOf<C2>();
    assertDeepEqual(result, {
      type: 'AddProductItem',
      data: d2,
      kind: 'Command',
      schemaVersion: 2,
    });
  });

  void it('creates a versioned command with the default metadata', () => {
    const result = command<C2>('AddProductItem', d2, { now }, 2);

    expectTypeOf(result).toEqualTypeOf<C2>();
    assertDeepEqual(result, {
      type: 'AddProductItem',
      data: d2,
      metadata: { now },
      kind: 'Command',
      schemaVersion: 2,
    });
  });

  void it('creates a versioned command without metadata when it is undefined', () => {
    const result = command<C2>('AddProductItem', d2, undefined, 2);

    assertDeepEqual(result, {
      type: 'AddProductItem',
      data: d2,
      kind: 'Command',
      schemaVersion: 2,
    });
  });

  void it('creates a versioned command with declared metadata', () => {
    const result = command<C2m>('AddProductItem', d2, metadata, 2);

    expectTypeOf(result).toEqualTypeOf<C2m>();
    assertDeepEqual(result, {
      type: 'AddProductItem',
      data: d2,
      metadata,
      kind: 'Command',
      schemaVersion: 2,
    });
  });

  void it('creates an unversioned command without schema version', () => {
    assertDeepEqual(command<C1>('AddProductItem', d1), {
      type: 'AddProductItem',
      data: d1,
      kind: 'Command',
    });
    assertDeepEqual(command<C1>('AddProductItem', d1, { now }), {
      type: 'AddProductItem',
      data: d1,
      metadata: { now },
      kind: 'Command',
    });
    assertDeepEqual(command<C1>('AddProductItem', d1, undefined), {
      type: 'AddProductItem',
      data: d1,
      kind: 'Command',
    });
  });

  void it('rejects command calls that do not match the declared schema version', () => {
    // @ts-expect-error the version is required for a declared version 2
    command<C2>('AddProductItem', d2);
    // @ts-expect-error the default metadata needs the version after it
    command<C2>('AddProductItem', d2, { now });
    // @ts-expect-error the version goes after the default metadata
    command<C2>('AddProductItem', d2, 2, { now });
    // @ts-expect-error the version must match the declared one
    command<C2>('AddProductItem', d2, 3);
    // @ts-expect-error the version must match the declared one
    command<C2>('AddProductItem', d2, { now }, 3);
    // @ts-expect-error undefined metadata needs the version after it
    command<C2>('AddProductItem', d2, undefined);
    // @ts-expect-error the version is required with declared metadata
    command<C2m>('AddProductItem', d2, metadata);
    // @ts-expect-error declared metadata cannot be replaced by undefined
    command<C2m>('AddProductItem', d2, undefined, 2);
    // @ts-expect-error declared metadata cannot be left out
    command<C2m>('AddProductItem', d2, 2);
    // @ts-expect-error an unversioned command takes no version
    command<C1>('AddProductItem', d1, 1);
    // @ts-expect-error an unversioned command takes no version
    command<C1>('AddProductItem', d1, { now }, 1);
    // @ts-expect-error only the default metadata fits a command without declared metadata
    command<C2>('AddProductItem', d2, { tenantId: 'tenant-a' }, 2);
  });

  void it('creates a message with the given schema version', () => {
    const versionedEvent = message<V2>('Event', 'ProductItemAdded', d2, 2);
    const versionedCommand = message<C2>('Command', 'AddProductItem', d2, 2);
    const withMetadata = message<V2m>(
      'Event',
      'ProductItemAdded',
      d2,
      metadata,
      2,
    );

    expectTypeOf(versionedEvent).toEqualTypeOf<V2>();
    assertDeepEqual(versionedEvent, {
      type: 'ProductItemAdded',
      data: d2,
      kind: 'Event',
      schemaVersion: 2,
    });
    assertDeepEqual(versionedCommand, {
      type: 'AddProductItem',
      data: d2,
      kind: 'Command',
      schemaVersion: 2,
    });
    assertDeepEqual(withMetadata, {
      type: 'ProductItemAdded',
      data: d2,
      metadata,
      kind: 'Event',
      schemaVersion: 2,
    });
  });

  void it('creates an unversioned message without schema version', () => {
    assertDeepEqual(message<V1>('Event', 'ProductItemAdded', d1), {
      type: 'ProductItemAdded',
      data: d1,
      kind: 'Event',
    });
  });

  void it('rejects message calls that do not match the declared schema version', () => {
    // @ts-expect-error the version is required for a declared version 2
    message<V2>('Event', 'ProductItemAdded', d2);
    // @ts-expect-error an unversioned message takes no version
    message<V1>('Event', 'ProductItemAdded', d1, 1);
  });
});
