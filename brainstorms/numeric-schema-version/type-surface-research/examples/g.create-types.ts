import {
  command,
  event,
  type Command,
  type CreateCommandType,
  type CreateEventType,
  type Event,
  type MessageSchemaVersionOf,
  type RecordedMessage,
} from '@event-driven-io/emmett';
import { assertType, v2, type D1, type Equals, type V2 } from './domain';

type V1c = CreateEventType<'ProductItemAdded', D1>;
type C1c = CreateCommandType<'AddProductItem', D1>;
const v1c: V1c = { type: 'ProductItemAdded', data: { productId: 'p' } };

// g1: constraint T extends Event / Command
const takesEvent = <T extends Event>(e: T) => e;
const takesCommand = <T extends Command>(c: T) => c;
takesEvent(v1c);
takesEvent<V1c | V2>(v2);
takesCommand<C1c>({ type: 'AddProductItem', data: { productId: 'p' } });

// g2: union with a Dreq type, switch on schemaVersion
type Mixed = V1c | V2;
export const g2 = (e: Mixed) => {
  switch (e.schemaVersion) {
    case 2:
      return e.data.productItem;
    default:
      return e.data.productId;
  }
};

// g3: 'in' narrowing works without a schemaVersion key
export const g3 = (e: Mixed) =>
  'schemaVersion' in e && e.schemaVersion === 2 ? e.data.productItem : e.data;

// g4: helpers with Create* types
const e1 = event<V1c>('ProductItemAdded', { productId: 'p' });
const c1 = command<C1c>('AddProductItem', { productId: 'p' }, { now: new Date() });

// g5: type helpers and recorded messages
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
assertType<Equals<MessageSchemaVersionOf<V1c>, {}>>();
assertType<Equals<V1c['schemaVersion' & keyof V1c], never>>();
assertType<Equals<RecordedMessage<V1c>['schemaVersion'], number>>();

export { e1, c1, v1c };
