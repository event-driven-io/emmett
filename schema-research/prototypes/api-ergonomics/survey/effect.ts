import { Data, Schema } from 'effect';
import { assert, type Equals } from './_assert';

// (a) one message: typeof S.Type
const Confirmed = Schema.TaggedStruct('Confirmed', { cartId: Schema.String, at: Schema.DateFromString });
type Confirmed = typeof Confirmed.Type;
assert<Equals<Confirmed, { readonly _tag: 'Confirmed'; readonly cartId: string; readonly at: Date }>>();
type ConfirmedEncoded = typeof Confirmed.Encoded;
assert<Equals<ConfirmedEncoded, { readonly _tag: 'Confirmed'; readonly cartId: string; readonly at: string }>>();
// (c) factory
export const c = Confirmed.make({ cartId: '1', at: new Date() });

// (b) union + (d) match/guards
const Cancelled = Schema.TaggedStruct('Cancelled', { cartId: Schema.String });
const CartEvent = Schema.Union([Confirmed, Cancelled]).pipe(Schema.toTaggedUnion('_tag'));
type CartEvent = typeof CartEvent.Type;
export const describe = CartEvent.match({
  Confirmed: (e) => e.at.toISOString(),
  Cancelled: (e) => e.cartId,
});
export const isConfirmed = CartEvent.guards.Confirmed;
export const all: CartEvent[] = [c];

// TaggedUnion builds the union from one record
const Shape = Schema.TaggedUnion({ Circle: { radius: Schema.Number }, Square: { side: Schema.Number } });
type Shape = typeof Shape.Type;
assert<Equals<Shape, { readonly _tag: 'Circle'; readonly radius: number } | { readonly _tag: 'Square'; readonly side: number }>>();

// (e) Class: value and type share one name, no typeof
export class Person extends Schema.Class<Person>('Person')({ name: Schema.String }) {}
export const p: Person = new Person({ name: 'A' });
export class Opened extends Schema.TaggedClass<Opened>()('Opened', { cartId: Schema.String }) {}
export const o: Opened = new Opened({ cartId: '1' });
assert<Equals<Opened['_tag'], 'Opened'>>();

// Data.TaggedEnum: type first, constructors derived
type RemoteData = Data.TaggedEnum<{ Loading: {}; Success: { readonly data: string } }>;
const { Loading, Success, $match } = Data.taggedEnum<RemoteData>();
export const r: RemoteData[] = [Loading(), Success({ data: 'x' })];
export const m = $match({ Loading: () => 'loading', Success: ({ data }) => data });
