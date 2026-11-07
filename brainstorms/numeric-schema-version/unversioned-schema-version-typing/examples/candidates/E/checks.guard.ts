import type { Command, Event, RecordedMessage } from './typing';
import { isSchemaVersion } from './typing';

type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
const assertType = <T extends true>(): T | undefined => undefined;

type D1 = { productId: string };
type D2 = { productItem: { productId: string; quantity: number } };
type V1 = Event<'ProductItemAdded', D1>;
type V2 = Event<'ProductItemAdded', D2, undefined, 2>;
type C1 = Command<'AddProductItem', D1>;
type C3 = Command<'AddProductItem', D2, undefined, 3>;

// ===CHECK a: event narrowing with a type guard
export const narrowEvent = (e: V1 | V2): D1 | D2 => {
  if (isSchemaVersion(e, 2)) {
    const data = e.data;
    assertType<Equals<typeof data, D2>>();
    // @ts-expect-error V2 data has no productId
    void e.data.productId;
    return data;
  }
  const data = e.data;
  assertType<Equals<typeof data, D1>>();
  return data;
};
// ===CHECK c: commands with a type guard
export const narrowCommand = (c: C1 | C3): D1 | D2 => {
  if (isSchemaVersion(c, 3)) {
    const data = c.data;
    assertType<Equals<typeof data, Readonly<D2>>>();
    return data;
  }
  const data = c.data;
  assertType<Equals<typeof data, Readonly<D1>>>();
  return data;
};
// ===CHECK f: recorded with a type guard
export const narrowRecorded = (e: RecordedMessage<V1 | V2>): D1 | D2 => {
  if (isSchemaVersion(e, 2)) {
    const data = e.data;
    assertType<Equals<typeof data, D2>>();
    return data;
  }
  const data = e.data;
  assertType<Equals<typeof data, D1>>();
  return data;
};
// ===CHECK g: upcast with a type guard
export const upcast = (e: V1 | V2): V2 =>
  isSchemaVersion(e, 2)
    ? e
    : {
        type: 'ProductItemAdded',
        data: { productItem: { productId: e.data.productId, quantity: 1 } },
        schemaVersion: 2,
      };
