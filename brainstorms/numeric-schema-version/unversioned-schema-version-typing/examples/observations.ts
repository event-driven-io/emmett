import type { Event, RecordedMessage } from './typing';

type D1 = { productId: string };
type D2 = { productItem: { productId: string; quantity: number } };
type V1 = Event<'ProductItemAdded', D1>;
type V2 = Event<'ProductItemAdded', D2, undefined, 2>;
type V1Explicit = Event<'ProductItemAdded', D1, undefined, 1>;
declare const v2: V2;

// REPORT b3: V1 value with schemaVersion 2
export const v1Version2: V1 = {
  type: 'ProductItemAdded',
  data: { productId: 'p' },
  schemaVersion: 2,
};
// REPORT e2: V2 assignable to Event<'ProductItemAdded'>
export const asNamedEvent: Event<'ProductItemAdded'> = v2;
// REPORT e3: V1 assignable to Event<'ProductItemAdded'>
declare const v1: V1;
export const v1AsNamedEvent: Event<'ProductItemAdded'> = v1;
// REPORT e4: explicit version 1 is the same type as no version
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
export const explicitOneEqualsNoVersion: Equals<V1, V1Explicit> = true;
// REPORT f2: recorded V1 schemaVersion type
export const recordedV1Version: Equals<RecordedMessage<V1>['schemaVersion'], 1> = true;
// REPORT e5: Event<string, D1> keeps number
export const stringTypedVersion: Equals<NonNullable<Event<string, D1>['schemaVersion']>, number> = true;
// REPORT b4: V2 value without schemaVersion
export const v2NoVersion: V2 = {
  type: 'ProductItemAdded',
  data: { productItem: { productId: 'p', quantity: 1 } },
};
// REPORT b5: explicitly versioned 1 value without schemaVersion
export const v1ExplicitNoVersion: V1Explicit = {
  type: 'ProductItemAdded',
  data: { productId: 'p' },
};
