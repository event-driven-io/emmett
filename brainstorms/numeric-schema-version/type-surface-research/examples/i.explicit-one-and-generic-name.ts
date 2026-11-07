import type { Event, RecordedMessage } from '@event-driven-io/emmett';
import { assertType, type D1, type D2, type Equals, type V1, type V2 } from './domain';

// i1: explicit 1 is the same type as no version
type V1x = Event<'ProductItemAdded', D1, undefined, 1>;
assertType<Equals<V1x, V1>>();
export const i1: V1x = { type: 'ProductItemAdded', data: { productId: 'p' } };
export const i1b: V1x = { type: 'ProductItemAdded', data: { productId: 'p' }, schemaVersion: 1 };
// @ts-expect-error 2 on a version 1 type
export const i1c: V1 = { type: 'ProductItemAdded', data: { productId: 'p' }, schemaVersion: 2 };

// i2: generic name keeps number
type Gen = Event<string, D1>;
assertType<Equals<Gen['schemaVersion'], number | undefined>>();
export const i2: Gen = { type: 'X', data: { productId: 'p' }, schemaVersion: 7 };
// a versioned literal type is assignable to the generic-name type
export const i2b: Event<string, D2> = {} as V2;
// a V2 value is not a version-1 type of the same name
// @ts-expect-error V2 is not Event<'ProductItemAdded', D2>
export const i2c: Event<'ProductItemAdded', D2> = {} as V2;

// i3: union of generic names does not narrow
export const i3 = (e: Event<string, D1> | Event<string, D2, undefined, 2>) => {
  switch (e.schemaVersion) {
    case 2:
      return e.data;
    default:
      return e.data;
  }
};

// i4: a string-typed name with a declared version
type GenV2 = Event<string, D2, undefined, 2>;
assertType<Equals<GenV2['schemaVersion'], 2>>();
assertType<Equals<RecordedMessage<Gen>['schemaVersion'], number>>();

// i5: version 0 and negative literals are required like any non-1 version
type V0 = Event<'ProductItemAdded', D1, undefined, 0>;
// @ts-expect-error version 0 required
export const i5: V0 = { type: 'ProductItemAdded', data: { productId: 'p' } };

// i6: union of literals as the version
type V23 = Event<'ProductItemAdded', D2, undefined, 2 | 3>;
assertType<Equals<V23['schemaVersion'], 2 | 3>>();
type V12 = Event<'ProductItemAdded', D2, undefined, 1 | 2>;
export const i6probe = (e: V12) => e.schemaVersion;
// a 1 | 2 version union allows leaving the version out, because the property type distributes
export const i6b: V12 = { type: 'ProductItemAdded', data: { productItem: { productId: 'p', quantity: 1 } } };
// @ts-expect-error a 2 | 3 version union still requires it
export const i6c: V23 = { type: 'ProductItemAdded', data: { productItem: { productId: 'p', quantity: 1 } } };
